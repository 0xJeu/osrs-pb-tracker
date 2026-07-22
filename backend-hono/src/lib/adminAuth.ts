import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { getCookie } from 'hono/cookie';
import type { MiddlewareHandler } from 'hono';

export const RECOVERY_ADMIN_USERNAME = 'admin';
export const RECOVERY_ADMIN_COOKIE = 'pb_recovery_admin';
export const RECOVERY_ADMIN_COOKIE_PATH = '/api/admin/recovery';
export const RECOVERY_ADMIN_SESSION_SECONDS = 8 * 60 * 60;

const MIN_ADMIN_PASSWORD_LENGTH = 12;
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_FAILURE_LIMIT = 5;
const loginFailures = new Map<string, number[]>();

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

export function recoveryAdminLoginBlocked(key: string, nowMs: number = Date.now()) {
  const recent = (loginFailures.get(key) ?? []).filter((time) => nowMs - time < LOGIN_WINDOW_MS);
  if (recent.length === 0) loginFailures.delete(key);
  else loginFailures.set(key, recent);
  return recent.length >= LOGIN_FAILURE_LIMIT;
}

export function recordRecoveryAdminLoginFailure(key: string, nowMs: number = Date.now()) {
  const recent = (loginFailures.get(key) ?? []).filter((time) => nowMs - time < LOGIN_WINDOW_MS);
  recent.push(nowMs);
  loginFailures.set(key, recent);
}

export function clearRecoveryAdminLoginFailures(key: string) {
  loginFailures.delete(key);
}

export function resetRecoveryAdminLoginLimiter() {
  loginFailures.clear();
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
