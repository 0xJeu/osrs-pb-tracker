import { randomBytes } from 'node:crypto';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { Hono, type Context } from 'hono';
import { deleteCookie, setCookie } from 'hono/cookie';
import { recoveryAdminPage } from '../admin/recoveryPage.js';
import { db } from '../db/client.js';
import {
  feedback,
  installRecoveryEvents,
  playerInstallCredentials,
  players,
  syncAttempts,
} from '../db/schema.js';
import {
  authenticateRecoveryAdmin,
  clearRecoveryAdminLoginFailures,
  createRecoveryAdminSession,
  RECOVERY_ADMIN_COOKIE,
  RECOVERY_ADMIN_COOKIE_PATH,
  RECOVERY_ADMIN_SESSION_SECONDS,
  RECOVERY_ADMIN_USERNAME,
  recoveryAdminClientKey,
  recoveryAdminIsConfigured,
  reserveRecoveryAdminLoginAttempt,
  requireRecoveryAdmin,
} from '../lib/adminAuth.js';
import {
  getSafeInstallRecoveryCandidate,
  listSafeInstallRecoveryCandidates,
  promoteInstallRecoveryCandidate,
  reactivatePlayerInstallCredential,
  reopenRejectedInstallRecoveryCandidate,
  RecoveryDecisionConflictError,
  rejectInstallRecoveryCandidate,
  revokePlayerInstallCredential,
  resolveInstallRecoveryContest,
} from '../lib/installRecovery.js';
import { assessInstallRecovery } from '../lib/recoveryAssessment.js';

const adminRecovery = new Hono();
const candidateApi = new Hono();
const installationApi = new Hono();

const statuses = [
  'invalidation_pending',
  'pending',
  'invalidation_failed',
  'contested',
  'promoted',
  'rejected',
] as const;
type CandidateStatus = (typeof statuses)[number];

interface DecisionBody {
  reason?: unknown;
}

interface LoginBody {
  username?: unknown;
  password?: unknown;
}

function loginClientKey(c: Context) {
  // Vercel overwrites this platform header rather than trusting a caller's
  // forwarded chain. The ordinary header remains a local/test fallback only.
  const platformIdentity = c.req.header('x-vercel-forwarded-for')?.split(',')[0]?.trim();
  const localIdentity = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
  return recoveryAdminClientKey(platformIdentity || localIdentity || 'unknown');
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
  const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
  if (reason.length < 5 || reason.length > 500) {
    return { error: 'reason is required and must be between 5 and 500 characters' } as const;
  }
  return { reason } as const;
}

function serializeCandidate(
  candidate: Awaited<ReturnType<typeof listSafeInstallRecoveryCandidates>>[number],
  events: Array<typeof installRecoveryEvents.$inferSelect>,
  supportMessages: Array<typeof feedback.$inferSelect>,
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
    activeInstallCount: candidate.activeInstallCount,
    installations: candidate.installations.map((install) => ({
      id: install.id,
      status: install.status,
      source: install.source,
      authorizedFromCandidateId: install.authorizedFromCandidateId,
      firstSeenAt: install.firstSeenAt.toISOString(),
      lastSeenAt: install.lastSeenAt.toISOString(),
      authorizedAt: install.authorizedAt.toISOString(),
      revokedAt: install.revokedAt?.toISOString() ?? null,
    })),
    assessment: assessInstallRecovery(candidate, lastAcceptedSyncAt),
    events: events.map((event) => ({
      eventType: event.eventType,
      actor: event.actor,
      reason: event.reason,
      createdAt: event.createdAt.toISOString(),
    })),
    supportMessages: supportMessages.map((entry) => ({
      message: entry.message,
      createdAt: entry.createdAt.toISOString(),
    })),
  };
}

function serializeSafeInstallation(install: typeof playerInstallCredentials.$inferSelect) {
  return {
    id: install.id,
    status: install.status,
    source: install.source,
    firstSeenAt: install.firstSeenAt.toISOString(),
    lastSeenAt: install.lastSeenAt.toISOString(),
    authorizedAt: install.authorizedAt.toISOString(),
    revokedAt: install.revokedAt?.toISOString() ?? null,
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
  if (!clientKey) {
    return c.json({ error: 'Recovery admin is not configured.' }, 503);
  }
  const reservation = await reserveRecoveryAdminLoginAttempt(clientKey);
  if (!reservation.allowed) {
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
    return c.json({ error: 'Invalid username or password.' }, 401);
  }

  await clearRecoveryAdminLoginFailures(clientKey, reservation);
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
installationApi.use('*', requireRecoveryAdmin);

installationApi.get('/', async (c) => {
  const playerIdRaw = c.req.query('playerId')?.trim();
  const displayName = c.req.query('displayName')?.trim();
  if ((!playerIdRaw && !displayName) || (playerIdRaw && displayName)) {
    return c.json({ error: 'provide exactly one of playerId or displayName' }, 400);
  }

  let matchingPlayers: Array<{ id: number; displayName: string }>;
  if (playerIdRaw) {
    const playerId = parseCandidateId(playerIdRaw);
    if (!playerId) return c.json({ error: 'player ID must be a positive integer' }, 400);
    matchingPlayers = await db
      .select({ id: players.id, displayName: players.displayName })
      .from(players)
      .where(eq(players.id, playerId))
      .limit(1);
  } else {
    if (!displayName || displayName.length > 50) {
      return c.json({ error: 'displayName must be between 1 and 50 characters' }, 400);
    }
    matchingPlayers = await db
      .select({ id: players.id, displayName: players.displayName })
      .from(players)
      .where(eq(players.displayNameLower, displayName.toLowerCase()))
      .limit(20);
  }

  const playerIds = matchingPlayers.map((player) => player.id);
  const installs = playerIds.length === 0
    ? []
    : await db
        .select()
        .from(playerInstallCredentials)
        .where(inArray(playerInstallCredentials.playerId, playerIds))
        .orderBy(desc(playerInstallCredentials.lastSeenAt));
  return c.json({
    players: matchingPlayers.map((player) => {
      const playerInstalls = installs.filter((install) => install.playerId === player.id);
      return {
        playerId: player.id,
        displayName: player.displayName,
        activeInstallCount: playerInstalls.filter((install) => install.status === 'active').length,
        installations: playerInstalls.map(serializeSafeInstallation),
      };
    }),
  });
});

candidateApi.get('/', async (c) => {
  const requestedStatus = c.req.query('status') ?? 'active';
  const requestedIdRaw = c.req.query('id');
  const requestedId = requestedIdRaw === undefined ? null : parseCandidateId(requestedIdRaw);
  if (requestedIdRaw !== undefined && !requestedId) {
    return c.json({ error: 'candidate ID must be a positive integer' }, 400);
  }
  if (requestedStatus !== 'active' && requestedStatus !== 'all' && !statuses.includes(requestedStatus as CandidateStatus)) {
    return c.json(
      {
        error:
          'status must be active, all, invalidation_pending, pending, invalidation_failed, contested, promoted, or rejected',
      },
      400
    );
  }

  const statusFilter: readonly CandidateStatus[] | undefined =
    requestedStatus === 'active'
      ? ['invalidation_pending', 'pending', 'invalidation_failed', 'contested']
      : requestedStatus === 'all'
        ? undefined
        : [requestedStatus as CandidateStatus];
  const directCandidate = requestedId ? await getSafeInstallRecoveryCandidate(requestedId) : null;
  const candidates = requestedId
    ? directCandidate ? [directCandidate] : []
    : await listSafeInstallRecoveryCandidates({
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

  const supportEntries =
    candidates.length === 0
      ? []
      : await db
          .select()
          .from(feedback)
          .where(inArray(feedback.context, candidates.map((candidate) => `recovery:${candidate.id}`)))
          .orderBy(desc(feedback.createdAt))
          .limit(500);
  const supportByCandidate = new Map<number, typeof supportEntries>();
  for (const entry of supportEntries) {
    const candidateId = Number(entry.context?.slice('recovery:'.length));
    if (!Number.isSafeInteger(candidateId)) continue;
    const candidateEntries = supportByCandidate.get(candidateId) ?? [];
    candidateEntries.push(entry);
    supportByCandidate.set(candidateId, candidateEntries);
  }

  return c.json({
    candidates: candidates.map((candidate) =>
      serializeCandidate(
        candidate,
        eventsByCandidate.get(candidate.id) ?? [],
        supportByCandidate.get(candidate.id) ?? [],
        lastAcceptedSyncByPlayer.get(candidate.playerId) ?? null
      )
    ),
  });
});

async function decide(c: Context, decision: 'promote' | 'replace' | 'reject' | 'resolve') {
  const candidateId = parseCandidateId(c.req.param('id'));
  if (!candidateId) return c.json({ error: 'candidate ID must be a positive integer' }, 400);

  const parsed = parseDecisionBody((await c.req.json().catch(() => null)) as DecisionBody | null);
  if ('error' in parsed) return c.json({ error: parsed.error }, 400);

  try {
    if (decision === 'promote' || decision === 'replace') {
      const result = await promoteInstallRecoveryCandidate(
        candidateId,
        RECOVERY_ADMIN_USERNAME,
        parsed.reason,
        decision === 'replace' ? 'replace' : 'additional'
      );
      return c.json({
        ok: true,
        decision,
        candidateId: result.candidateId,
        playerId: result.playerId,
        changedPbCount: result.changedBosses.length,
        authorizationMode: result.mode,
        revokedInstallCount: result.revokedInstallCount,
      });
    }
    if (decision === 'resolve') {
      const result = await resolveInstallRecoveryContest(
        candidateId,
        RECOVERY_ADMIN_USERNAME,
        parsed.reason
      );
      return c.json({
        ok: true,
        decision,
        candidateId: result.candidateId,
        playerId: result.playerId,
        rejectedCompetitorCount: result.rejectedCompetitorCount,
      });
    }

    const result = await rejectInstallRecoveryCandidate(
      candidateId,
      RECOVERY_ADMIN_USERNAME,
      parsed.reason
    );
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
candidateApi.post('/:id/replace', (c) => decide(c, 'replace'));
candidateApi.post('/:id/reject', (c) => decide(c, 'reject'));
candidateApi.post('/:id/resolve', (c) => decide(c, 'resolve'));
candidateApi.post('/:id/reopen', async (c) => {
  const candidateId = parseCandidateId(c.req.param('id'));
  if (!candidateId) return c.json({ error: 'candidate ID must be a positive integer' }, 400);
  const parsed = parseDecisionBody((await c.req.json().catch(() => null)) as DecisionBody | null);
  if ('error' in parsed) return c.json({ error: parsed.error }, 400);
  try {
    const result = await reopenRejectedInstallRecoveryCandidate(
      candidateId,
      RECOVERY_ADMIN_USERNAME,
      parsed.reason
    );
    return c.json({ ok: true, decision: 'reopen', ...result });
  } catch (error) {
    if (error instanceof RecoveryDecisionConflictError) {
      return c.json({ error: error.message, code: 'RECOVERY_DECISION_CONFLICT' }, 409);
    }
    throw error;
  }
});

async function decideInstallation(c: Context, decision: 'revoke' | 'reactivate') {
  const credentialId = parseCandidateId(c.req.param('id'));
  if (!credentialId) return c.json({ error: 'installation ID must be a positive integer' }, 400);
  const parsed = parseDecisionBody((await c.req.json().catch(() => null)) as DecisionBody | null);
  if ('error' in parsed) return c.json({ error: parsed.error }, 400);
  try {
    if (decision === 'revoke') {
      const result = await revokePlayerInstallCredential(
        credentialId,
        RECOVERY_ADMIN_USERNAME,
        parsed.reason
      );
      return c.json({ ok: true, decision, ...result });
    }
    const result = await reactivatePlayerInstallCredential(
      credentialId,
      RECOVERY_ADMIN_USERNAME,
      parsed.reason
    );
    return c.json({ ok: true, decision, ...result });
  } catch (error) {
    if (error instanceof RecoveryDecisionConflictError) {
      return c.json({ error: error.message, code: 'RECOVERY_DECISION_CONFLICT' }, 409);
    }
    throw error;
  }
}

// Keep the original candidate-nested action paths compatible with the first
// admin UI release while exposing installation management independently of
// candidate retention.
candidateApi.post('/installations/:id/revoke', (c) => decideInstallation(c, 'revoke'));
candidateApi.post('/installations/:id/reactivate', (c) => decideInstallation(c, 'reactivate'));
installationApi.post('/:id/revoke', (c) => decideInstallation(c, 'revoke'));
installationApi.post('/:id/reactivate', (c) => decideInstallation(c, 'reactivate'));

adminRecovery.route('/candidates', candidateApi);
adminRecovery.route('/installations', installationApi);

export default adminRecovery;
