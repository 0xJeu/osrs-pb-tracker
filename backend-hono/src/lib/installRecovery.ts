import { createHash } from 'node:crypto';
import { and, desc, eq, inArray, lt } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  installRecoveryCandidates,
  installRecoveryEvents,
} from '../db/schema.js';
import {
  bossCacheTag,
  cacheTags,
  invalidateSharedCache,
  playerIdCacheTag,
  profileBossBucketCacheTag,
  profileBossExactCacheTag,
} from './cache.js';
import { invalidatePlayerSyncReplay } from './syncReplay.js';

const RECOVERABLE_STATUSES = [
  'invalidation_pending',
  'pending',
  'invalidation_failed',
  'contested',
] as const;

const MAX_CANDIDATES_PER_CREDENTIAL_EPOCH = 5;
const RECOVERY_CANDIDATE_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const RECOVERY_CANDIDATE_CLEANUP_INTERVAL = 100;

export type RecoveryCandidateStatus =
  | 'invalidation_pending'
  | 'pending'
  | 'invalidation_failed'
  | 'contested'
  | 'promoted'
  | 'rejected';

export interface RecoveryContinuity {
  equalCount: number;
  improvedCount: number;
  newCount: number;
  slowerCount: number;
  missingCount: number;
}

export interface RecoveryCandidateSummary extends RecoveryContinuity {
  id: number;
  status: RecoveryCandidateStatus;
  attemptCount: number;
  receivedCount: number;
  eligibleCount: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
}

// This is the only recovery-candidate projection intended for operator-facing
// tools. Keep credential hashes, payloads, and payload digests out of it so a
// CLI or future admin UI cannot expose them accidentally by serializing a full
// database row.
const safeRecoveryCandidateColumns = {
  id: installRecoveryCandidates.id,
  playerId: installRecoveryCandidates.playerId,
  displayName: installRecoveryCandidates.displayName,
  status: installRecoveryCandidates.status,
  attemptCount: installRecoveryCandidates.attemptCount,
  receivedCount: installRecoveryCandidates.receivedCount,
  eligibleCount: installRecoveryCandidates.eligibleCount,
  equalCount: installRecoveryCandidates.equalCount,
  improvedCount: installRecoveryCandidates.improvedCount,
  newCount: installRecoveryCandidates.newCount,
  slowerCount: installRecoveryCandidates.slowerCount,
  missingCount: installRecoveryCandidates.missingCount,
  firstSeenAt: installRecoveryCandidates.firstSeenAt,
  lastSeenAt: installRecoveryCandidates.lastSeenAt,
  promotedAt: installRecoveryCandidates.promotedAt,
  rejectedAt: installRecoveryCandidates.rejectedAt,
} as const;

export async function listSafeInstallRecoveryCandidates(options?: {
  statuses?: readonly RecoveryCandidateStatus[];
  limit?: number;
}) {
  const statusFilter = options?.statuses?.length
    ? inArray(installRecoveryCandidates.status, [...options.statuses])
    : undefined;
  return db
    .select(safeRecoveryCandidateColumns)
    .from(installRecoveryCandidates)
    .where(statusFilter)
    .orderBy(desc(installRecoveryCandidates.lastSeenAt))
    .limit(options?.limit ?? 1_000);
}

export async function getSafeInstallRecoveryCandidate(candidateId: number) {
  const [candidate] = await db
    .select(safeRecoveryCandidateColumns)
    .from(installRecoveryCandidates)
    .where(eq(installRecoveryCandidates.id, candidateId))
    .limit(1);
  return candidate ?? null;
}

function stablePayload(pbsByBoss: Map<string, number>) {
  return Object.fromEntries([...pbsByBoss.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

function payloadDigest(payload: Record<string, number>) {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

export async function pruneExpiredInstallRecoveryCandidates(latestCandidateId: number) {
  if (latestCandidateId % RECOVERY_CANDIDATE_CLEANUP_INTERVAL !== 0) {
    return;
  }

  try {
    await db
      .delete(installRecoveryCandidates)
      .where(
        lt(
          installRecoveryCandidates.lastSeenAt,
          new Date(Date.now() - RECOVERY_CANDIDATE_RETENTION_MS)
        )
      );
  } catch (error) {
    // Retention is opportunistic and must never turn a safely rejected sync
    // into a server error. Candidate/event foreign keys handle cleanup.
    console.error('Failed to prune expired install recovery candidates', {
      error: error instanceof Error ? error.message : 'unknown error',
    });
  }
}

export async function captureInstallRecoveryCandidate(values: {
  playerId: number;
  incumbentSecretHash: string;
  candidateSecretHash: string;
  displayName: string;
  receivedCount: number;
  pbsByBoss: Map<string, number>;
}): Promise<RecoveryCandidateSummary> {
  const now = new Date();
  const payload = stablePayload(values.pbsByBoss);
  const payloadJson = JSON.stringify(payload);
  const digest = payloadDigest(payload);

  // The player-row lock is the serialization boundary shared with incumbent
  // sync commits and promotion. Candidate upsert, continuity calculation, and
  // competing-candidate contestation therefore commit as one ordered action.
  const [lockedRows, previousRows, , , finalRows] = await db.$client.transaction((txn) => [
    txn(
      'SELECT id FROM players WHERE id = $1 AND install_secret_hash = $2 FOR UPDATE',
      [values.playerId, values.incumbentSecretHash]
    ),
    txn(
      `SELECT id, status
       FROM install_recovery_candidates
       WHERE player_id = $1
         AND incumbent_secret_hash = $2
         AND candidate_secret_hash = $3
       LIMIT 1`,
      [values.playerId, values.incumbentSecretHash, values.candidateSecretHash]
    ),
    txn(
      `WITH incoming AS (
         SELECT key AS boss, value::real AS time_seconds
         FROM jsonb_each_text($5::jsonb)
       ), continuity AS (
         SELECT
           COUNT(*) FILTER (
             WHERE stored.boss IS NOT NULL
               AND ABS(stored.time_seconds - incoming.time_seconds) < 0.001
           )::int AS equal_count,
           COUNT(*) FILTER (
             WHERE stored.boss IS NOT NULL
               AND incoming.time_seconds < stored.time_seconds
               AND ABS(stored.time_seconds - incoming.time_seconds) >= 0.001
           )::int AS improved_count,
           COUNT(*) FILTER (WHERE stored.boss IS NULL)::int AS new_count,
           COUNT(*) FILTER (
             WHERE stored.boss IS NOT NULL
               AND incoming.time_seconds > stored.time_seconds
               AND ABS(stored.time_seconds - incoming.time_seconds) >= 0.001
           )::int AS slower_count
         FROM incoming
         LEFT JOIN personal_bests AS stored
           ON stored.player_id = $1 AND stored.boss = incoming.boss
       ), missing AS (
         SELECT COUNT(*)::int AS missing_count
         FROM personal_bests AS stored
         LEFT JOIN incoming ON incoming.boss = stored.boss
         WHERE stored.player_id = $1 AND incoming.boss IS NULL
       ), incumbent AS (
         SELECT id FROM players WHERE id = $1 AND install_secret_hash = $2
       ), admitted AS (
         SELECT incumbent.id
         FROM incumbent
         WHERE EXISTS (
           SELECT 1
           FROM install_recovery_candidates AS existing
           WHERE existing.player_id = incumbent.id
             AND existing.incumbent_secret_hash = $2
             AND existing.candidate_secret_hash = $3
         ) OR (
           SELECT COUNT(*)
           FROM install_recovery_candidates AS existing
           WHERE existing.player_id = incumbent.id
             AND existing.incumbent_secret_hash = $2
             AND existing.status IN (
               'invalidation_pending', 'pending', 'invalidation_failed', 'contested'
             )
         ) < $10
       )
       INSERT INTO install_recovery_candidates (
         player_id, incumbent_secret_hash, candidate_secret_hash, status, display_name,
         payload, payload_digest, received_count, eligible_count,
         equal_count, improved_count, new_count, slower_count, missing_count,
         first_seen_at, last_seen_at
       )
       SELECT admitted.id, $2, $3, 'invalidation_pending', $4, $5::jsonb, $6, $7, $8,
              continuity.equal_count, continuity.improved_count,
              continuity.new_count, continuity.slower_count,
              missing.missing_count, $9, $9
       FROM admitted CROSS JOIN continuity CROSS JOIN missing
       ON CONFLICT (player_id, incumbent_secret_hash, candidate_secret_hash)
       DO UPDATE SET
         status = CASE
           WHEN install_recovery_candidates.status = 'pending'
             THEN 'invalidation_pending'
           ELSE install_recovery_candidates.status
         END,
         display_name = EXCLUDED.display_name,
         payload = EXCLUDED.payload,
         payload_digest = EXCLUDED.payload_digest,
         attempt_count = install_recovery_candidates.attempt_count + 1,
         received_count = EXCLUDED.received_count,
         eligible_count = EXCLUDED.eligible_count,
         equal_count = EXCLUDED.equal_count,
         improved_count = EXCLUDED.improved_count,
         new_count = EXCLUDED.new_count,
         slower_count = EXCLUDED.slower_count,
         missing_count = EXCLUDED.missing_count,
         last_seen_at = EXCLUDED.last_seen_at
       RETURNING id`,
      [
        values.playerId,
        values.incumbentSecretHash,
        values.candidateSecretHash,
        values.displayName,
        payloadJson,
        digest,
        values.receivedCount,
        values.pbsByBoss.size,
        now,
        MAX_CANDIDATES_PER_CREDENTIAL_EPOCH,
      ]
    ),
    txn(
      `UPDATE install_recovery_candidates
       SET status = 'contested'
       WHERE player_id = $1
         AND status IN ('invalidation_pending', 'pending', 'invalidation_failed', 'contested')
         AND (
           SELECT COUNT(*)
           FROM install_recovery_candidates
           WHERE player_id = $1
             AND status IN ('invalidation_pending', 'pending', 'invalidation_failed', 'contested')
         ) > 1`,
      [values.playerId]
    ),
    txn(
      `SELECT id, status, attempt_count, received_count, eligible_count,
              equal_count, improved_count, new_count, slower_count,
              missing_count, first_seen_at, last_seen_at
       FROM install_recovery_candidates
       WHERE player_id = $1
         AND incumbent_secret_hash = $2
         AND candidate_secret_hash = $3
         AND EXISTS (
           SELECT 1 FROM players
           WHERE id = $1 AND install_secret_hash = $2
         )
       LIMIT 1`,
      [values.playerId, values.incumbentSecretHash, values.candidateSecretHash]
    ),
  ]);

  const candidate = finalRows[0];
  if (!candidate) {
    if (lockedRows.length > 0) {
      throw new RecoveryCandidateLimitError(
        'Too many recovery candidates exist for the current credential epoch.'
      );
    }
    throw new RecoveryDecisionConflictError(
      'The incumbent credential changed while the recovery candidate was being captured.'
    );
  }
  let status = String(candidate.status) as RecoveryCandidateStatus;
  const previousStatus = previousRows[0]?.status
    ? (String(previousRows[0].status) as RecoveryCandidateStatus)
    : null;
  const ownsInvalidation = previousStatus === null || previousStatus === 'pending';

  // A cached successful-replay entry could otherwise let the incumbent's own
  // resync of an already-seen payload skip upsertPlayer/noteIncumbentSeen
  // entirely, leaving this candidate wrongly promotable while the incumbent
  // is still active. Invalidating just this player's entries forces the next
  // sync on this account to be evaluated for real, without giving a public
  // caller a way to evict every player's replay protection.
  if (status === 'invalidation_pending' && ownsInvalidation) {
    const replayInvalidated = await invalidatePlayerSyncReplay(values.playerId);
    const finalStatus = replayInvalidated ? 'pending' : 'invalidation_failed';
    const [, finalizedRows] = await db.$client.transaction((txn) => [
      txn('SELECT id FROM players WHERE id = $1 FOR UPDATE', [values.playerId]),
      txn(
        `WITH transitioned AS (
           UPDATE install_recovery_candidates
           SET status = $4
           WHERE id = $2
             AND status = 'invalidation_pending'
             AND EXISTS (
               SELECT 1 FROM players
               WHERE id = $1 AND install_secret_hash = $3
             )
           RETURNING id, player_id, status
         ), failure_event AS (
           INSERT INTO install_recovery_events
             (candidate_id, player_id, event_type, actor, reason, created_at)
           SELECT id, player_id, 'replay_invalidation_unconfirmed', 'system',
                  'Could not confirm the incumbent cached sync replay was invalidated. Promotion remains disabled because activity during the cache outage cannot be ruled out.',
                  NOW()
           FROM transitioned
           WHERE $4 = 'invalidation_failed'
         )
         SELECT status FROM transitioned
         UNION ALL
         SELECT status
         FROM install_recovery_candidates
         WHERE id = $2
           AND NOT EXISTS (SELECT 1 FROM transitioned)`,
        [values.playerId, candidate.id, values.incumbentSecretHash, finalStatus]
      ),
    ]);
    status = String(finalizedRows[0]?.status ?? status) as RecoveryCandidateStatus;
  }

  await pruneExpiredInstallRecoveryCandidates(Number(candidate.id));

  return {
    id: Number(candidate.id),
    status,
    attemptCount: Number(candidate.attempt_count),
    receivedCount: Number(candidate.received_count),
    eligibleCount: Number(candidate.eligible_count),
    equalCount: Number(candidate.equal_count),
    improvedCount: Number(candidate.improved_count),
    newCount: Number(candidate.new_count),
    slowerCount: Number(candidate.slower_count),
    missingCount: Number(candidate.missing_count),
    firstSeenAt: new Date(String(candidate.first_seen_at)),
    lastSeenAt: new Date(String(candidate.last_seen_at)),
  };
}

export async function noteIncumbentCredentialSeen(playerId: number) {
  await db.$client.transaction((txn) => [
    txn('SELECT id FROM players WHERE id = $1 FOR UPDATE', [playerId]),
    txn(
      `WITH transitioned AS (
         UPDATE install_recovery_candidates
         SET status = 'contested'
         WHERE player_id = $1
           AND status IN ('invalidation_pending', 'pending', 'invalidation_failed')
         RETURNING id
       )
       INSERT INTO install_recovery_events
         (candidate_id, player_id, event_type, actor, reason, created_at)
       SELECT id, $1, 'incumbent_seen', 'system',
              'The incumbent credential synced while recovery was pending.', NOW()
       FROM transitioned`,
      [playerId]
    ),
  ]);
}

export class RecoveryDecisionConflictError extends Error {}

export class RecoveryCandidateLimitError extends Error {}

export async function promoteInstallRecoveryCandidate(candidateId: number, actor: string, reason?: string) {
  // The lock and decision deliberately use separate READ COMMITTED statements.
  // If this waits behind an incumbent sync or competing capture, the second
  // statement receives a fresh snapshot and sees the state transition that
  // occurred before the lock became available.
  const [, promotedRows] = await db.$client.transaction((txn) => [
    txn(
      `SELECT player.id
       FROM players AS player
       JOIN install_recovery_candidates AS candidate ON candidate.player_id = player.id
       WHERE candidate.id = $1
       FOR UPDATE OF player`,
      [candidateId]
    ),
    txn(
      `WITH candidate AS MATERIALIZED (
         SELECT candidate.*
         FROM install_recovery_candidates AS candidate
         JOIN players AS player ON player.id = candidate.player_id
         WHERE candidate.id = $1
           AND candidate.status = 'pending'
           AND player.install_secret_hash = candidate.incumbent_secret_hash
           AND NOT EXISTS (
             SELECT 1
             FROM install_recovery_candidates AS competing
             WHERE competing.player_id = candidate.player_id
               AND competing.id <> candidate.id
               AND competing.status IN (
                 'invalidation_pending', 'pending', 'invalidation_failed', 'contested'
               )
           )
       ), promoted_player AS (
         UPDATE players AS player
         SET install_secret_hash = candidate.candidate_secret_hash
         FROM candidate
         WHERE player.id = candidate.player_id
           AND player.install_secret_hash = candidate.incumbent_secret_hash
         RETURNING player.id
       ), promoted_candidate AS (
         UPDATE install_recovery_candidates AS stored_candidate
         SET status = 'promoted', promoted_at = NOW()
         FROM candidate, promoted_player
         WHERE stored_candidate.id = candidate.id
           AND stored_candidate.status = 'pending'
         RETURNING stored_candidate.*
       ), upserted AS (
         INSERT INTO personal_bests (player_id, boss, time_seconds, updated_at)
         SELECT promoted_candidate.player_id,
                payload.key,
                (payload.value #>> '{}')::real,
                NOW()
         FROM promoted_candidate
         CROSS JOIN LATERAL jsonb_each(promoted_candidate.payload) AS payload
         ON CONFLICT (player_id, boss) DO UPDATE
           SET time_seconds = EXCLUDED.time_seconds,
               updated_at = EXCLUDED.updated_at
           WHERE EXCLUDED.time_seconds < personal_bests.time_seconds
         RETURNING boss
       ), recovery_event AS (
         INSERT INTO install_recovery_events
           (candidate_id, player_id, event_type, actor, reason, created_at)
         SELECT promoted_candidate.id,
                promoted_candidate.player_id,
                'promoted', $2, $3, NOW()
         FROM promoted_candidate
       )
       SELECT promoted_candidate.id AS candidate_id,
              promoted_candidate.player_id,
              COALESCE(
                (SELECT array_agg(upserted.boss) FROM upserted),
                ARRAY[]::text[]
              ) AS changed_bosses
       FROM promoted_candidate`,
      [candidateId, actor, reason ?? null]
    ),
  ]);

  const promoted = promotedRows[0] as
    | { candidate_id: number; player_id: number; changed_bosses: string[] }
    | undefined;
  if (!promoted) {
    throw new RecoveryDecisionConflictError(
      'Recovery candidate is no longer pending or the incumbent credential changed.'
    );
  }

  await invalidateSharedCache([
    cacheTags.bossList,
    cacheTags.search,
    cacheTags.stats,
    playerIdCacheTag(promoted.player_id),
    ...promoted.changed_bosses.flatMap((boss) => [
      bossCacheTag(boss),
      profileBossExactCacheTag(boss),
      profileBossBucketCacheTag(boss),
    ]),
  ]);

  // The former incumbent's last successful sync may still be a cached replay
  // hit. Without this, that credential could keep getting served fake 200s
  // for up to the replay TTL after its binding was just replaced. This runs
  // after the promotion has already committed and never throws, so a cache
  // hiccup here can't turn a successful promotion into a reported failure.
  await invalidatePlayerSyncReplay(promoted.player_id);

  return {
    candidateId: promoted.candidate_id,
    playerId: promoted.player_id,
    changedBosses: promoted.changed_bosses,
  };
}

export async function rejectInstallRecoveryCandidate(candidateId: number, actor: string, reason?: string) {
  const [, rejectedRows] = await db.$client.transaction((txn) => [
    txn(
      `SELECT player.id
       FROM players AS player
       JOIN install_recovery_candidates AS candidate ON candidate.player_id = player.id
       WHERE candidate.id = $1
       FOR UPDATE OF player`,
      [candidateId]
    ),
    txn(
      `WITH rejected AS (
         UPDATE install_recovery_candidates
         SET status = 'rejected', rejected_at = NOW()
         WHERE id = $1
           AND status IN (
             'invalidation_pending', 'pending', 'invalidation_failed', 'contested'
           )
         RETURNING id, player_id
       ), recovery_event AS (
         INSERT INTO install_recovery_events
           (candidate_id, player_id, event_type, actor, reason, created_at)
         SELECT rejected.id, rejected.player_id, 'rejected', $2, $3, NOW()
         FROM rejected
       )
       SELECT rejected.id AS candidate_id, rejected.player_id
       FROM rejected`,
      [candidateId, actor, reason ?? null]
    ),
  ]);

  const rejected = rejectedRows[0] as
    | { candidate_id: number; player_id: number }
    | undefined;
  if (!rejected) {
    throw new RecoveryDecisionConflictError('Recovery candidate is no longer pending or contested.');
  }
  return { candidateId: rejected.candidate_id, playerId: rejected.player_id };
}

/**
 * Resolves a contested credential epoch without changing the player's bound
 * install credential. The operator chooses the candidate identified through
 * support, every competing active candidate from the same incumbent epoch is
 * rejected, and the chosen candidate returns to pending for a separate,
 * deliberate promotion decision.
 *
 * Keeping resolution and promotion separate is intentional: resolving a
 * contest is not itself proof that the replacement credential should own the
 * account. A returning incumbent sync will contest the candidate again before
 * promotion because both paths serialize on the player row.
 */
export async function resolveInstallRecoveryContest(
  candidateId: number,
  actor: string,
  reason: string
) {
  const [, resolvedRows] = await db.$client.transaction((txn) => [
    txn(
      `SELECT player.id
       FROM players AS player
       JOIN install_recovery_candidates AS candidate ON candidate.player_id = player.id
       WHERE candidate.id = $1
       FOR UPDATE OF player`,
      [candidateId]
    ),
    txn(
      `WITH selected AS MATERIALIZED (
         SELECT candidate.id, candidate.player_id, candidate.incumbent_secret_hash
         FROM install_recovery_candidates AS candidate
         JOIN players AS player ON player.id = candidate.player_id
         WHERE candidate.id = $1
           AND candidate.status = 'contested'
           AND player.install_secret_hash = candidate.incumbent_secret_hash
       ), rejected_competitors AS (
         UPDATE install_recovery_candidates AS competitor
         SET status = 'rejected', rejected_at = NOW()
         FROM selected
         WHERE competitor.player_id = selected.player_id
           AND competitor.incumbent_secret_hash = selected.incumbent_secret_hash
           AND competitor.id <> selected.id
           AND competitor.status IN (
             'invalidation_pending', 'pending', 'invalidation_failed', 'contested'
           )
         RETURNING competitor.id, competitor.player_id
       ), resolved AS (
         UPDATE install_recovery_candidates AS candidate
         SET status = 'pending', rejected_at = NULL
         FROM selected
         WHERE candidate.id = selected.id
           AND candidate.status = 'contested'
         RETURNING candidate.id, candidate.player_id
       ), competitor_events AS (
         INSERT INTO install_recovery_events
           (candidate_id, player_id, event_type, actor, reason, created_at)
         SELECT id, player_id, 'contest_competitor_rejected', $2, $3, NOW()
         FROM rejected_competitors
       ), resolution_event AS (
         INSERT INTO install_recovery_events
           (candidate_id, player_id, event_type, actor, reason, created_at)
         SELECT id, player_id, 'contest_resolved', $2, $3, NOW()
         FROM resolved
       )
       SELECT resolved.id AS candidate_id,
              resolved.player_id,
              (SELECT COUNT(*)::int FROM rejected_competitors) AS rejected_competitor_count
       FROM resolved`,
      [candidateId, actor, reason]
    ),
  ]);

  const resolved = resolvedRows[0] as
    | { candidate_id: number; player_id: number; rejected_competitor_count: number }
    | undefined;
  if (!resolved) {
    throw new RecoveryDecisionConflictError(
      'Recovery candidate is no longer contested or the incumbent credential changed.'
    );
  }

  return {
    candidateId: resolved.candidate_id,
    playerId: resolved.player_id,
    rejectedCompetitorCount: Number(resolved.rejected_competitor_count),
  };
}
