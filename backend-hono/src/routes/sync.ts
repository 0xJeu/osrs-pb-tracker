import { and, eq, isNull, lt, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../db/client.js';
import { personalBests, players, syncAttempts } from '../db/schema.js';
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
  RecoveryCandidateLimitError,
} from '../lib/installRecovery.js';
import {
  buildSyncReplayKey,
  getSuccessfulSyncReplay,
  noteSuccessfulSyncReplay,
  rememberSuccessfulSync,
} from '../lib/syncReplay.js';
import {
  isReasonablePersonalBestTime,
  isRedundantDuplicateKey,
  isTrackedBoss,
} from '../lib/trackedBosses.js';

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

async function resolvePlayer(accountHash: string, displayName: string, secretHash: string) {
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

  let incumbentSecretHash = existing.installSecretHash;
  if (!incumbentSecretHash) {
    const [claimed] = await db
      .update(players)
      .set({ installSecretHash: secretHash })
      .where(and(eq(players.id, existing.id), isNull(players.installSecretHash)))
      .returning({ installSecretHash: players.installSecretHash });
    incumbentSecretHash = claimed?.installSecretHash ?? null;
    if (!incumbentSecretHash) {
      const [current] = await db
        .select({ installSecretHash: players.installSecretHash })
        .from(players)
        .where(eq(players.id, existing.id))
        .limit(1);
      incumbentSecretHash = current?.installSecretHash ?? null;
    }
  }

  if (incumbentSecretHash !== secretHash) {
    return {
      playerId: existing.id,
      authorized: false,
      metadataChanged: false,
      created: false,
      incumbentSecretHash,
      namesToInvalidate: [] as string[],
    };
  }

  return {
    playerId: existing.id,
    authorized: true,
    metadataChanged: existing.displayName !== displayName,
    created: false,
    incumbentSecretHash,
    namesToInvalidate:
      existing.displayName === displayName
        ? [] as string[]
        : [existing.displayNameLower, displayNameLower],
  };
}

export async function commitExistingAuthorizedSync(values: {
  playerId: number;
  secretHash: string;
  displayName: string;
  displayNameLower: string;
  pbsByBoss: Map<string, number>;
}) {
  const payload = JSON.stringify(Object.fromEntries(values.pbsByBoss));
  const [lockedRows, , renamedRows, , changedRows] = await db.$client.transaction((txn) => [
    txn(
      'SELECT id FROM players WHERE id = $1 AND install_secret_hash = $2 FOR UPDATE',
      [values.playerId, values.secretHash]
    ),
    txn(
      `INSERT INTO player_name_history
         (player_id, display_name, display_name_lower, created_at)
       SELECT id, display_name, display_name_lower, NOW()
       FROM players
       WHERE id = $1
         AND install_secret_hash = $2
         AND display_name <> $3
       ON CONFLICT DO NOTHING`,
      [values.playerId, values.secretHash, values.displayName]
    ),
    txn(
      `WITH current AS MATERIALIZED (
         SELECT id, display_name_lower
         FROM players
         WHERE id = $1 AND install_secret_hash = $2 AND display_name <> $3
       )
       UPDATE players
       SET display_name = $3, display_name_lower = $4, updated_at = NOW()
       FROM current
       WHERE players.id = current.id
       RETURNING current.display_name_lower AS old_display_name_lower`,
      [values.playerId, values.secretHash, values.displayName, values.displayNameLower]
    ),
    txn(
      `WITH authorized AS (
         SELECT id FROM players WHERE id = $1 AND install_secret_hash = $2
       ), transitioned AS (
         UPDATE install_recovery_candidates
         SET status = 'contested'
         FROM authorized
         WHERE player_id = authorized.id
           AND status IN ('invalidation_pending', 'pending', 'invalidation_failed')
         RETURNING install_recovery_candidates.id
       )
       INSERT INTO install_recovery_events
         (candidate_id, player_id, event_type, actor, reason, created_at)
       SELECT id, $1, 'incumbent_seen', 'system',
              'The incumbent credential synced while recovery was pending.', NOW()
       FROM transitioned`,
      [values.playerId, values.secretHash]
    ),
    txn(
      `WITH incoming AS (
         SELECT key AS boss, value::real AS time_seconds
         FROM jsonb_each_text($3::jsonb)
       ), authorized AS (
         SELECT id FROM players WHERE id = $1 AND install_secret_hash = $2
       )
       INSERT INTO personal_bests (player_id, boss, time_seconds, updated_at)
       SELECT authorized.id, incoming.boss, incoming.time_seconds, NOW()
       FROM authorized CROSS JOIN incoming
       ON CONFLICT (player_id, boss) DO UPDATE
         SET time_seconds = EXCLUDED.time_seconds, updated_at = EXCLUDED.updated_at
         WHERE EXCLUDED.time_seconds < personal_bests.time_seconds
       RETURNING boss`,
      [values.playerId, values.secretHash, payload]
    ),
  ]);

  return {
    authorized: lockedRows.length > 0,
    metadataChanged: renamedRows.length > 0,
    namesToInvalidate:
      renamedRows.length === 0
        ? [] as string[]
        : [String(renamedRows[0].old_display_name_lower), values.displayNameLower],
    changedBosses: [...new Set(changedRows.map((row) => String(row.boss)))],
  };
}

export function normalizePbEntries(entries: Array<[string, unknown]>) {
  const pbsByBoss = new Map<string, number>();
  for (const [rawBoss, seconds] of entries) {
    const boss = rawBoss.trim().toLowerCase();
    const timeSeconds = Number(seconds);
    if (!boss || !isReasonablePersonalBestTime(boss, timeSeconds)) {
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
  } = await resolvePlayer(accountHash, displayName, secretHash);

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
      if (!(error instanceof RecoveryCandidateLimitError)) {
        console.error('Failed to capture install recovery candidate', {
          playerId,
          error: error instanceof Error ? error.message : 'unknown error',
        });
      }
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
      ? recoveryCandidate.status === 'invalidation_pending'
        ? 'RECOVERY_INVALIDATION_PENDING'
        : recoveryCandidate.status === 'contested'
        ? 'RECOVERY_CONTESTED'
        : recoveryCandidate.status === 'invalidation_failed'
          ? 'RECOVERY_INVALIDATION_FAILED'
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

  const committed = created
    ? {
        authorized: true,
        metadataChanged,
        namesToInvalidate,
        changedBosses: await upsertPbs(playerId, pbsByBoss),
      }
    : await commitExistingAuthorizedSync({
        playerId,
        secretHash,
        displayName,
        displayNameLower: displayName.toLowerCase(),
        pbsByBoss,
      });

  // A promotion may have replaced the credential after the initial lookup.
  // The transaction above locks and rechecks the player row before any name,
  // recovery-state, or PB mutation, so an in-flight former credential fails
  // closed instead of writing after the handoff boundary.
  if (!committed.authorized) {
    const syncAttemptId = await recordSyncAttempt({
      playerId,
      outcome: 'install_secret_mismatch',
      httpStatus: 409,
      receivedCount: entries.length,
      eligibleCount: pbsByBoss.size,
    });
    return c.json(
      {
        error: 'This account is already bound to a different install.',
        code: 'INSTALL_SECRET_CHANGED',
        recoveryId: null,
        retryAfterSeconds: null,
        syncAttemptId,
      },
      409
    );
  }

  const finalMetadataChanged = created || committed.metadataChanged;
  const finalNamesToInvalidate = created ? namesToInvalidate : committed.namesToInvalidate;
  const changedBosses = committed.changedBosses;
  const meaningfulChange = created || finalMetadataChanged || changedBosses.length > 0;
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

  if (finalMetadataChanged) {
    invalidationTags.push(
      cacheTags.search,
      cacheTags.recentSyncs,
      playerIdCacheTag(playerId),
      ...finalNamesToInvalidate.map(playerNameCacheTag)
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
