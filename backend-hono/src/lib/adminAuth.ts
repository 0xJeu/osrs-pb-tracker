import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { getCookie } from 'hono/cookie';
import type { MiddlewareHandler } from 'hono';
import { db } from '../db/client.js';
import { recoveryAdminLoginLimits } from '../db/schema.js';

export const RECOVERY_ADMIN_USERNAME = 'admin';
export const RECOVERY_ADMIN_COOKIE = 'pb_recovery_admin';
export const RECOVERY_ADMIN_COOKIE_PATH = '/api/admin/recovery';
export const RECOVERY_ADMIN_SESSION_SECONDS = 8 * 60 * 60;

const MIN_ADMIN_PASSWORD_LENGTH = 12;
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_FAILURE_LIMIT = 5;

function digest(value: string) {
  return createHash('sha256').update(value).digest();
}

function safeEqual(left: string, right: string) {
  return timingSafeEqual(digest(left), digest(right));
}

function configuredPassword() {
  const password = process.env.RECOVERY_ADMIN_PASSWORD;
  if (
    !password ||
    password.length < MIN_ADMIN_PASSWORD_LENGTH ||
    password.startsWith('replace-with-')
  ) {
    return null;
  }
  return password;
}

function sessionSignature(payload: string, password: string) {
  return createHmac('sha256', password).update(payload).digest('hex');
}

export function recoveryAdminIsConfigured() {
  return configuredPassword() !== null;
}

export function authenticateRecoveryAdmin(username: string, password: string) {
  const expectedPassword = configuredPassword();
  return (
    expectedPassword !== null &&
    safeEqual(username, RECOVERY_ADMIN_USERNAME) &&
    safeEqual(password, expectedPassword)
  );
}

export function recoveryAdminClientKey(clientIdentity: string) {
  const password = configuredPassword();
  if (!password) return null;
  return createHmac('sha256', password)
    .update(`recovery-admin-login-v1\0${clientIdentity}`)
    .digest('hex');
}

export function createRecoveryAdminSession(nowMs: number = Date.now()) {
  const password = configuredPassword();
  if (!password) throw new Error('Recovery admin is not configured.');

  const expiresAt = Math.floor(nowMs / 1000) + RECOVERY_ADMIN_SESSION_SECONDS;
  const nonce = randomBytes(18).toString('base64url');
  const payload = `v1.${expiresAt}.${nonce}`;
  return `${payload}.${sessionSignature(payload, password)}`;
}

export function verifyRecoveryAdminSession(value: string | undefined, nowMs: number = Date.now()) {
  const password = configuredPassword();
  if (!password || !value) return false;

  const parts = value.split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') return false;
  const expiresAt = Number(parts[1]);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= Math.floor(nowMs / 1000)) return false;

  const payload = parts.slice(0, 3).join('.');
  return safeEqual(parts[3], sessionSignature(payload, password));
}

export interface RecoveryAdminLoginReservation {
  allowed: boolean;
  attemptCount: number;
  windowStartedAt: Date;
}

export async function reserveRecoveryAdminLoginAttempt(
  keyHash: string,
  nowMs: number = Date.now()
): Promise<RecoveryAdminLoginReservation> {
  const now = new Date(nowMs);
  const cutoff = new Date(nowMs - LOGIN_WINDOW_MS);
  const reserved = await db
    .insert(recoveryAdminLoginLimits)
    .values({ keyHash, failureCount: 1, windowStartedAt: now })
    .onConflictDoUpdate({
      target: recoveryAdminLoginLimits.keyHash,
      set: {
        failureCount: sql`CASE
          WHEN ${recoveryAdminLoginLimits.windowStartedAt} <= ${cutoff}
            THEN 1
          ELSE LEAST(${recoveryAdminLoginLimits.failureCount} + 1, ${LOGIN_FAILURE_LIMIT + 1})
        END`,
        windowStartedAt: sql`CASE
          WHEN ${recoveryAdminLoginLimits.windowStartedAt} <= ${cutoff}
            THEN ${now}
          ELSE ${recoveryAdminLoginLimits.windowStartedAt}
        END`,
      },
    })
    .returning({
      attemptCount: recoveryAdminLoginLimits.failureCount,
      windowStartedAt: recoveryAdminLoginLimits.windowStartedAt,
    });

  // Expired keys from other clients are no longer useful. Login volume is low,
  // and the indexed timestamp keeps this global retention pass bounded.
  try {
    await db.delete(recoveryAdminLoginLimits).where(
      and(
        sql`${recoveryAdminLoginLimits.windowStartedAt} <= ${cutoff}`,
        sql`${recoveryAdminLoginLimits.keyHash} <> ${keyHash}`
      )
    );
  } catch (error) {
    // Retention must not change whether this already-reserved login attempt is
    // evaluated. The next request will retry the indexed cleanup.
    console.warn('Unable to prune expired recovery admin login limits', {
      error: error instanceof Error ? error.message : 'unknown error',
    });
  }

  return {
    allowed: reserved[0].attemptCount <= LOGIN_FAILURE_LIMIT,
    attemptCount: reserved[0].attemptCount,
    windowStartedAt: reserved[0].windowStartedAt,
  };
}

export async function clearRecoveryAdminLoginFailures(
  keyHash: string,
  reservation: RecoveryAdminLoginReservation
) {
  // Do not erase attempts that arrived after this successful request reserved
  // its slot. Those requests may still be evaluating invalid credentials.
  await db.delete(recoveryAdminLoginLimits).where(
    and(
      eq(recoveryAdminLoginLimits.keyHash, keyHash),
      eq(recoveryAdminLoginLimits.failureCount, reservation.attemptCount),
      eq(recoveryAdminLoginLimits.windowStartedAt, reservation.windowStartedAt)
    )
  );
}

export async function resetRecoveryAdminLoginLimiter() {
  await db.delete(recoveryAdminLoginLimits);
}

export const requireRecoveryAdmin: MiddlewareHandler = async (c, next) => {
  c.header('Cache-Control', 'no-store');

  if (!recoveryAdminIsConfigured()) {
    return c.json({ error: 'Recovery admin is not configured.' }, 503);
  }

  if (!verifyRecoveryAdminSession(getCookie(c, RECOVERY_ADMIN_COOKIE))) {
    return c.json({ error: 'Unauthorized.' }, 401);
  }

  await next();
};
