import { eq, lt, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../db/client.js';
import { personalBests, playerNameHistory, players, syncAttempts } from '../db/schema.js';
import {
  bossCacheTag,
  cacheTags,
  invalidateSharedCache,
  playerIdCacheTag,
  playerNameCacheTag,
  profileBossBucketCacheTag,
} from '../lib/cache.js';
import { hashSecret, isRateLimited } from '../lib/secret.js';
import {
  captureInstallRecoveryCandidate,
  noteIncumbentCredentialSeen,
} from '../lib/installRecovery.js';
import {
  buildSyncReplayKey,
  getSuccessfulSyncReplay,
  noteSuccessfulSyncReplay,
  rememberSuccessfulSync,
} from '../lib/syncReplay.js';
import { isRedundantDuplicateKey, isTrackedBoss } from '../lib/trackedBosses.js';

const sync = new Hono();

interface SyncBody {
  accountHash?: unknown;
  displayName?: unknown;
  installSecret?: unknown;
  pbs?: unknown;
}

type SyncAttemptOutcome = 'accepted' | 'install_secret_mismatch';

const SYNC_ATTEMPT_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const SYNC_ATTEMPT_CLEANUP_INTERVAL = 100;

export async function pruneExpiredSyncAttempts(latestAttemptId: number) {
  if (latestAttemptId % SYNC_ATTEMPT_CLEANUP_INTERVAL !== 0) {
    return;
  }

  try {
    await db
      .delete(syncAttempts)
      .where(lt(syncAttempts.createdAt, new Date(Date.now() - SYNC_ATTEMPT_RETENTION_MS)));
  } catch (error) {
    // Retention is deliberately opportunistic. A cleanup problem should be
    // visible in logs but must not change the result of a player's sync.
    console.error('Failed to prune expired sync attempts', {
      error: error instanceof Error ? error.message : 'unknown error',
    });
  }
}

async function recordSyncAttempt(values: {
  playerId: number;
  outcome: SyncAttemptOutcome;
  httpStatus: number;
  receivedCount: number;
  eligibleCount?: number;
  updatedCount?: number;
  recoveryCandidateId?: number;
}) {
  try {
    const [attempt] = await db
      .insert(syncAttempts)
      .values({
        ...values,
        eligibleCount: values.eligibleCount ?? null,
        updatedCount: values.updatedCount ?? null,
        recoveryCandidateId: values.recoveryCandidateId ?? null,
        createdAt: new Date(),
      })
      .returning({ id: syncAttempts.id });
    await pruneExpiredSyncAttempts(attempt.id);
    return attempt.id;
  } catch (error) {
    // Observability must never become a new failure mode for PB syncing. Keep
    // this credential-free so the fallback Vercel log is safe to retain.
    console.error('Failed to record sync attempt', {
      playerId: values.playerId,
      outcome: values.outcome,
      error: error instanceof Error ? error.message : 'unknown error',
    });
    return null;
  }
}

async function upsertPlayer(accountHash: string, displayName: string, secretHash: string) {
  const displayNameLower = displayName.toLowerCase();
  const existingRows = await db
    .select({
      id: players.id,
      displayName: players.displayName,
      displayNameLower: players.displayNameLower,
      installSecretHash: players.installSecretHash,
    })
    .from(players)
    .where(eq(players.accountHash, accountHash))
    .limit(1);
  const existing = existingRows[0];

  if (!existing) {
    const [inserted] = await db
      .insert(players)
      .values({
        accountHash,
        displayName,
        displayNameLower,
        installSecretHash: secretHash,
        updatedAt: new Date(),
      })
      .returning({ id: players.id });
    return {
      playerId: inserted.id,
      authorized: true,
      metadataChanged: true,
      created: true,
      incumbentSecretHash: null,
      namesToInvalidate: [displayNameLower],
    };
  }

  if (!existing.installSecretHash) {
    await db.update(players).set({ installSecretHash: secretHash }).where(eq(players.id, existing.id));
  } else if (existing.installSecretHash !== secretHash) {
    return {
      playerId: existing.id,
      authorized: false,
      metadataChanged: false,
      created: false,
      incumbentSecretHash: existing.installSecretHash,
      namesToInvalidate: [] as string[],
    };
  }

  let metadataChanged = false;
  const namesToInvalidate: string[] = [];
  if (existing.displayName !== displayName) {
    await db
      .insert(playerNameHistory)
      .values({
        playerId: existing.id,
        displayName: existing.displayName,
        displayNameLower: existing.displayNameLower,
        createdAt: new Date(),
      })
      .onConflictDoNothing();
    await db
      .update(players)
      .set({ displayName, displayNameLower, updatedAt: new Date() })
      .where(eq(players.id, existing.id));
    metadataChanged = true;
    namesToInvalidate.push(existing.displayNameLower, displayNameLower);
  }

  return {
    playerId: existing.id,
    authorized: true,
    metadataChanged,
    created: false,
    incumbentSecretHash: existing.installSecretHash,
    namesToInvalidate,
  };
}

export function normalizePbEntries(entries: Array<[string, unknown]>) {
  const pbsByBoss = new Map<string, number>();
  for (const [rawBoss, seconds] of entries) {
    const boss = rawBoss.trim().toLowerCase();
    const timeSeconds = Number(seconds);
    if (!boss || !Number.isFinite(timeSeconds) || timeSeconds <= 0) {
      continue;
    }
    if (!isTrackedBoss(boss) || isRedundantDuplicateKey(boss)) {
      continue;
    }

    // Different raw keys can normalize to the same boss. Keep the fastest so
    // one batched INSERT never attempts to affect the same conflict row twice.
    const pendingTime = pbsByBoss.get(boss);
    if (pendingTime === undefined || timeSeconds < pendingTime) {
      pbsByBoss.set(boss, timeSeconds);
    }
  }
  return pbsByBoss;
}

// Invariant: `updated_at` must only move on insert or a strictly faster time.
// The frontend's "Recorded" column reads this column directly, so an equal
// or slower resync must leave the existing row (including its timestamp)
// completely untouched - see sync.test.ts's "only overwrites a PB when the
// new time is faster" test, which locks this in.
async function upsertPbs(playerId: number, pbsByBoss: Map<string, number>) {
  if (pbsByBoss.size === 0) {
    return [] as string[];
  }

  const updatedAt = new Date();
  const changed = await db
    .insert(personalBests)
    .values(
      Array.from(pbsByBoss, ([boss, timeSeconds]) => ({
        playerId,
        boss,
        timeSeconds,
        updatedAt,
      }))
    )
    .onConflictDoUpdate({
      target: [personalBests.playerId, personalBests.boss],
      set: { timeSeconds: sql`excluded.time_seconds`, updatedAt },
      setWhere: sql`excluded.time_seconds < ${personalBests.timeSeconds}`,
    })
    .returning({ boss: personalBests.boss });

  return [...new Set(changed.map((row) => row.boss))];
}

sync.post('/', async (c) => {
  const body = (await c.req.json().catch(() => null)) as SyncBody | null;
  const accountHash = body?.accountHash;
  const displayName = body?.displayName;
  const installSecret = body?.installSecret;
  const pbs = body?.pbs;

  if (!accountHash || typeof accountHash !== 'string') {
    return c.json({ error: 'accountHash is required' }, 400);
  }
  if (!displayName || typeof displayName !== 'string') {
    return c.json({ error: 'displayName is required' }, 400);
  }
  if (!installSecret || typeof installSecret !== 'string' || installSecret.length < 16) {
    return c.json({ error: 'installSecret is required (min 16 chars)' }, 400);
  }
  if (!pbs || typeof pbs !== 'object' || Array.isArray(pbs)) {
    return c.json({ error: 'pbs must be an object of { bossName: seconds }' }, 400);
  }

  const entries = Object.entries(pbs as Record<string, unknown>);
  const pbsByBoss = normalizePbEntries(entries);
  const secretHash = hashSecret(installSecret);
  const replayKey = buildSyncReplayKey({
    accountHash,
    displayName,
    secretHash,
    entries,
  });
  const replay = await getSuccessfulSyncReplay(replayKey);

  if (replay) {
    noteSuccessfulSyncReplay();
    return c.json({
      ok: true,
      playerId: replay.playerId,
      received: replay.received,
      updated: 0,
      syncAttemptId: null,
      deduplicated: true,
    });
  }

  if (isRateLimited(accountHash)) {
    // Do not query or write Neon while shedding load. Vercel request logs
    // retain the 429 count without turning rejected traffic into DB traffic.
    return c.json({ error: 'Too many sync requests for this account, slow down.', syncAttemptId: null }, 429);
  }

  const {
    playerId,
    authorized,
    metadataChanged,
    created,
    incumbentSecretHash,
    namesToInvalidate,
  } = await upsertPlayer(accountHash, displayName, secretHash);

  if (!authorized) {
    let recoveryCandidate:
      | Awaited<ReturnType<typeof captureInstallRecoveryCandidate>>
      | null = null;
    try {
      if (incumbentSecretHash) {
        recoveryCandidate = await captureInstallRecoveryCandidate({
          playerId,
          incumbentSecretHash,
          candidateSecretHash: secretHash,
          displayName,
          receivedCount: entries.length,
          pbsByBoss,
        });
      }
    } catch (error) {
      // Recovery support must not turn a safe credential rejection into a 500.
      // Keep this credential- and payload-free for retained server logs.
      console.error('Failed to capture install recovery candidate', {
        playerId,
        error: error instanceof Error ? error.message : 'unknown error',
      });
    }

    const syncAttemptId = await recordSyncAttempt({
      playerId,
      outcome: 'install_secret_mismatch',
      httpStatus: 409,
      receivedCount: entries.length,
      eligibleCount: pbsByBoss.size,
      recoveryCandidateId: recoveryCandidate?.id,
    });
    const code = recoveryCandidate
      ? recoveryCandidate.status === 'contested'
        ? 'RECOVERY_CONTESTED'
        : recoveryCandidate.status === 'rejected'
          ? 'RECOVERY_REJECTED'
          : 'RECOVERY_PENDING'
      : 'INSTALL_SECRET_MISMATCH';
    return c.json(
      {
        error: 'This account is already bound to a different install.',
        code,
        recoveryId: recoveryCandidate?.id ?? null,
        retryAfterSeconds: recoveryCandidate ? 900 : null,
        syncAttemptId,
      },
      409
    );
  }

  if (!created) {
    await noteIncumbentCredentialSeen(playerId);
  }

  const changedBosses = await upsertPbs(playerId, pbsByBoss);
  const meaningfulChange = created || metadataChanged || changedBosses.length > 0;
  const syncAttemptId = meaningfulChange
    ? await recordSyncAttempt({
        playerId,
        outcome: 'accepted',
        httpStatus: 200,
        receivedCount: entries.length,
        eligibleCount: pbsByBoss.size,
        updatedCount: changedBosses.length,
      })
    : null;
  const invalidationTags: string[] = [];

  if (metadataChanged) {
    invalidationTags.push(
      cacheTags.search,
      cacheTags.recentSyncs,
      playerIdCacheTag(playerId),
      ...namesToInvalidate.map(playerNameCacheTag)
    );
  }

  if (created) {
    invalidationTags.push(cacheTags.stats);
  }

  if (changedBosses.length > 0) {
    invalidationTags.push(
      cacheTags.bossList,
      cacheTags.search,
      cacheTags.stats,
      playerIdCacheTag(playerId),
      ...changedBosses.flatMap((boss) => [bossCacheTag(boss), profileBossBucketCacheTag(boss)])
    );
  }

  await invalidateSharedCache(invalidationTags);
  await rememberSuccessfulSync(replayKey, {
    playerId,
    received: entries.length,
  });

  return c.json({
    ok: true,
    playerId,
    received: entries.length,
    updated: changedBosses.length,
    syncAttemptId,
  });
});

export default sync;
