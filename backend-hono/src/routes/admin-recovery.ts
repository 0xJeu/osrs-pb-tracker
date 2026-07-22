import { randomBytes } from 'node:crypto';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { Hono, type Context } from 'hono';
import { deleteCookie, setCookie } from 'hono/cookie';
import { recoveryAdminPage } from '../admin/recoveryPage.js';
import { db } from '../db/client.js';
import { installRecoveryEvents, syncAttempts } from '../db/schema.js';
import {
  authenticateRecoveryAdmin,
  clearRecoveryAdminLoginFailures,
  createRecoveryAdminSession,
  RECOVERY_ADMIN_COOKIE,
  RECOVERY_ADMIN_COOKIE_PATH,
  RECOVERY_ADMIN_SESSION_SECONDS,
  RECOVERY_ADMIN_USERNAME,
  recordRecoveryAdminLoginFailure,
  recoveryAdminIsConfigured,
  recoveryAdminLoginBlocked,
  requireRecoveryAdmin,
} from '../lib/adminAuth.js';
import {
  promoteInstallRecoveryCandidate,
  RecoveryDecisionConflictError,
  rejectInstallRecoveryCandidate,
  listSafeInstallRecoveryCandidates,
} from '../lib/installRecovery.js';
import { assessInstallRecovery } from '../lib/recoveryAssessment.js';

const adminRecovery = new Hono();
const candidateApi = new Hono();

const statuses = ['pending', 'contested', 'promoted', 'rejected'] as const;
type CandidateStatus = (typeof statuses)[number];

interface DecisionBody {
  actor?: unknown;
  reason?: unknown;
}

interface LoginBody {
  username?: unknown;
  password?: unknown;
}

function loginClientKey(c: Context) {
  return c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
}

function secureCookies() {
  return Boolean(process.env.VERCEL) || process.env.NODE_ENV === 'production';
}

function parseCandidateId(value: string | undefined) {
  if (!value) return null;
  if (!/^[1-9]\d*$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function parseDecisionBody(body: DecisionBody | null) {
  const actor = typeof body?.actor === 'string' ? body.actor.trim() : '';
  const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
  if (!actor || actor.length > 80) {
    return { error: 'actor is required and must be at most 80 characters' } as const;
  }
  if (reason.length < 5 || reason.length > 500) {
    return { error: 'reason is required and must be between 5 and 500 characters' } as const;
  }
  return { actor, reason } as const;
}

function serializeCandidate(
  candidate: Awaited<ReturnType<typeof listSafeInstallRecoveryCandidates>>[number],
  events: Array<typeof installRecoveryEvents.$inferSelect>,
  lastAcceptedSyncAt: Date | null
) {
  return {
    id: candidate.id,
    playerId: candidate.playerId,
    displayName: candidate.displayName,
    status: candidate.status,
    attemptCount: candidate.attemptCount,
    receivedCount: candidate.receivedCount,
    eligibleCount: candidate.eligibleCount,
    equalCount: candidate.equalCount,
    improvedCount: candidate.improvedCount,
    newCount: candidate.newCount,
    slowerCount: candidate.slowerCount,
    missingCount: candidate.missingCount,
    firstSeenAt: candidate.firstSeenAt.toISOString(),
    lastSeenAt: candidate.lastSeenAt.toISOString(),
    promotedAt: candidate.promotedAt?.toISOString() ?? null,
    rejectedAt: candidate.rejectedAt?.toISOString() ?? null,
    assessment: assessInstallRecovery(candidate, lastAcceptedSyncAt),
    events: events.map((event) => ({
      eventType: event.eventType,
      actor: event.actor,
      reason: event.reason,
      createdAt: event.createdAt.toISOString(),
    })),
  };
}

adminRecovery.get('/', (c) => {
  const nonce = randomBytes(18).toString('base64');
  c.header('Cache-Control', 'no-store');
  c.header('Referrer-Policy', 'no-referrer');
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header(
    'Content-Security-Policy',
    `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`
  );
  return c.html(recoveryAdminPage(nonce));
});

adminRecovery.post('/login', async (c) => {
  c.header('Cache-Control', 'no-store');
  if (!recoveryAdminIsConfigured()) {
    return c.json({ error: 'Recovery admin is not configured.' }, 503);
  }

  const clientKey = loginClientKey(c);
  if (recoveryAdminLoginBlocked(clientKey)) {
    return c.json({ error: 'Too many failed login attempts. Try again later.' }, 429);
  }

  const body = (await c.req.json().catch(() => null)) as LoginBody | null;
  const username = typeof body?.username === 'string' ? body.username.trim() : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  if (
    username.length > 80 ||
    password.length > 1_024 ||
    !authenticateRecoveryAdmin(username, password)
  ) {
    recordRecoveryAdminLoginFailure(clientKey);
    return c.json({ error: 'Invalid username or password.' }, 401);
  }

  clearRecoveryAdminLoginFailures(clientKey);
  setCookie(c, RECOVERY_ADMIN_COOKIE, createRecoveryAdminSession(), {
    httpOnly: true,
    secure: secureCookies(),
    sameSite: 'Strict',
    path: RECOVERY_ADMIN_COOKIE_PATH,
    maxAge: RECOVERY_ADMIN_SESSION_SECONDS,
  });
  return c.json({ ok: true, username: RECOVERY_ADMIN_USERNAME });
});

adminRecovery.post('/logout', requireRecoveryAdmin, (c) => {
  c.header('Cache-Control', 'no-store');
  deleteCookie(c, RECOVERY_ADMIN_COOKIE, {
    secure: secureCookies(),
    path: RECOVERY_ADMIN_COOKIE_PATH,
  });
  return c.json({ ok: true });
});

adminRecovery.get('/session', requireRecoveryAdmin, (c) =>
  c.json({ authenticated: true, username: RECOVERY_ADMIN_USERNAME })
);

candidateApi.use('*', requireRecoveryAdmin);

candidateApi.get('/', async (c) => {
  const requestedStatus = c.req.query('status') ?? 'active';
  if (requestedStatus !== 'active' && requestedStatus !== 'all' && !statuses.includes(requestedStatus as CandidateStatus)) {
    return c.json({ error: 'status must be active, all, pending, contested, promoted, or rejected' }, 400);
  }

  const statusFilter: readonly CandidateStatus[] | undefined =
    requestedStatus === 'active'
      ? ['pending', 'contested']
      : requestedStatus === 'all'
        ? undefined
        : [requestedStatus as CandidateStatus];
  const candidates = await listSafeInstallRecoveryCandidates({
    statuses: statusFilter,
    limit: 100,
  });

  const events =
    candidates.length === 0
      ? []
      : await db
          .select()
          .from(installRecoveryEvents)
          .where(
            inArray(
              installRecoveryEvents.candidateId,
              candidates.map((candidate) => candidate.id)
            )
          )
          .orderBy(desc(installRecoveryEvents.createdAt));
  const eventsByCandidate = new Map<number, typeof events>();
  for (const event of events) {
    const candidateEvents = eventsByCandidate.get(event.candidateId) ?? [];
    candidateEvents.push(event);
    eventsByCandidate.set(event.candidateId, candidateEvents);
  }

  const acceptedAttempts =
    candidates.length === 0
      ? []
      : await db
          .select({ playerId: syncAttempts.playerId, createdAt: syncAttempts.createdAt })
          .from(syncAttempts)
          .where(
            and(
              inArray(
                syncAttempts.playerId,
                candidates.map((candidate) => candidate.playerId)
              ),
              eq(syncAttempts.outcome, 'accepted')
            )
          )
          .orderBy(desc(syncAttempts.createdAt));
  const lastAcceptedSyncByPlayer = new Map<number, Date>();
  for (const attempt of acceptedAttempts) {
    if (!lastAcceptedSyncByPlayer.has(attempt.playerId)) {
      lastAcceptedSyncByPlayer.set(attempt.playerId, attempt.createdAt);
    }
  }

  return c.json({
    candidates: candidates.map((candidate) =>
      serializeCandidate(
        candidate,
        eventsByCandidate.get(candidate.id) ?? [],
        lastAcceptedSyncByPlayer.get(candidate.playerId) ?? null
      )
    ),
  });
});

async function decide(c: Context, decision: 'promote' | 'reject') {
  const candidateId = parseCandidateId(c.req.param('id'));
  if (!candidateId) return c.json({ error: 'candidate ID must be a positive integer' }, 400);

  const parsed = parseDecisionBody((await c.req.json().catch(() => null)) as DecisionBody | null);
  if ('error' in parsed) return c.json({ error: parsed.error }, 400);

  try {
    if (decision === 'promote') {
      const result = await promoteInstallRecoveryCandidate(candidateId, parsed.actor, parsed.reason);
      return c.json({
        ok: true,
        decision,
        candidateId: result.candidateId,
        playerId: result.playerId,
        changedPbCount: result.changedBosses.length,
      });
    }

    const result = await rejectInstallRecoveryCandidate(candidateId, parsed.actor, parsed.reason);
    return c.json({
      ok: true,
      decision,
      candidateId: result.candidateId,
      playerId: result.playerId,
    });
  } catch (error) {
    if (error instanceof RecoveryDecisionConflictError) {
      return c.json(
        {
          error: error.message,
          code: 'RECOVERY_DECISION_CONFLICT',
        },
        409
      );
    }
    throw error;
  }
}

candidateApi.post('/:id/promote', (c) => decide(c, 'promote'));
candidateApi.post('/:id/reject', (c) => decide(c, 'reject'));

adminRecovery.route('/candidates', candidateApi);

export default adminRecovery;
