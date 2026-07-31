import { createHash } from 'node:crypto';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
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
} from './cache.js';
import { invalidatePlayerSyncReplay } from './syncReplay.js';

const RECOVERABLE_STATUSES = ['pending', 'invalidation_failed', 'contested'] as const;

export type RecoveryCandidateStatus =
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
  const [, , , finalRows] = await db.$client.transaction((txn) => [
    txn(
      'SELECT id FROM players WHERE id = $1 AND install_secret_hash = $2 FOR UPDATE',
      [values.playerId, values.incumbentSecretHash]
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
       )
       INSERT INTO install_recovery_candidates (
         player_id, incumbent_secret_hash, candidate_secret_hash, display_name,
         payload, payload_digest, received_count, eligible_count,
         equal_count, improved_count, new_count, slower_count, missing_count,
         first_seen_at, last_seen_at
       )
       SELECT incumbent.id, $2, $3, $4, $5::jsonb, $6, $7, $8,
              continuity.equal_count, continuity.improved_count,
              continuity.new_count, continuity.slower_count,
              missing.missing_count, $9, $9
       FROM incumbent CROSS JOIN continuity CROSS JOIN missing
       ON CONFLICT (player_id, incumbent_secret_hash, candidate_secret_hash)
       DO UPDATE SET
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
      ]
    ),
    txn(
      `UPDATE install_recovery_candidates
       SET status = 'contested'
       WHERE player_id = $1
         AND status IN ('pending', 'invalidation_failed', 'contested')
         AND (
           SELECT COUNT(*)
           FROM install_recovery_candidates
           WHERE player_id = $1
             AND status IN ('pending', 'invalidation_failed', 'contested')
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
    throw new RecoveryDecisionConflictError(
      'The incumbent credential changed while the recovery candidate was being captured.'
    );
  }
  let status = String(candidate.status) as RecoveryCandidateStatus;

  // A cached successful-replay entry could otherwise let the incumbent's own
  // resync of an already-seen payload skip upsertPlayer/noteIncumbentSeen
  // entirely, leaving this candidate wrongly promotable while the incumbent
  // is still active. Invalidating just this player's entries forces the next
  // sync on this account to be evaluated for real, without giving a public
  // caller a way to evict every player's replay protection.
  const replayInvalidated = await invalidatePlayerSyncReplay(values.playerId);
  if (!replayInvalidated && status === 'pending') {
    // Unlike promotion (where invalidation is best-effort), success here is
    // a correctness dependency: without it we cannot guarantee the
    // incumbent's last successful sync isn't still served from cache,
    // silently bypassing noteIncumbentCredentialSeen(). Fail closed instead
    // of leaving an unconfirmed candidate promotable.
    const transitioned = await db
      .update(installRecoveryCandidates)
      .set({ status: 'invalidation_failed' })
      .where(
        and(
          eq(installRecoveryCandidates.id, candidate.id),
          eq(installRecoveryCandidates.status, 'pending')
        )
      )
      .returning({ id: installRecoveryCandidates.id });
    if (transitioned.length > 0) {
      await db.insert(installRecoveryEvents).values({
        candidateId: candidate.id,
        playerId: values.playerId,
        eventType: 'replay_invalidation_unconfirmed',
        actor: 'system',
        reason:
          "Could not confirm the incumbent's cached sync replay was invalidated. Promotion remains disabled because activity during the cache outage cannot be ruled out.",
        createdAt: now,
      });
      status = 'invalidation_failed';
    } else {
      const [current] = await db
        .select({ status: installRecoveryCandidates.status })
        .from(installRecoveryCandidates)
        .where(eq(installRecoveryCandidates.id, candidate.id))
        .limit(1);
      status = current.status as RecoveryCandidateStatus;
    }
  }

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
           AND status IN ('pending', 'invalidation_failed')
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

export async function promoteInstallRecoveryCandidate(candidateId: number, actor: string, reason?: string) {
  const result = await db.execute<{
    candidate_id: number;
    player_id: number;
    changed_bosses: string[];
  }>(sql`
    WITH candidate AS (
      SELECT *
      FROM install_recovery_candidates
      WHERE id = ${candidateId} AND status = 'pending'
    ),
    locked_player AS MATERIALIZED (
      SELECT player.id
      FROM players AS player
      JOIN candidate ON candidate.player_id = player.id
      WHERE player.install_secret_hash = candidate.incumbent_secret_hash
      FOR UPDATE OF player
    ),
    selected AS (
      SELECT candidate.*
      FROM candidate
      JOIN locked_player ON locked_player.id = candidate.player_id
      WHERE NOT EXISTS (
        SELECT 1
        FROM install_recovery_candidates AS competing
        WHERE competing.player_id = candidate.player_id
          AND competing.id <> candidate.id
          AND competing.status IN ('pending', 'invalidation_failed', 'contested')
      )
    ),
    promoted_player AS (
      UPDATE players AS player
      SET install_secret_hash = selected.candidate_secret_hash
      FROM selected
      WHERE player.id = selected.player_id
        AND player.install_secret_hash = selected.incumbent_secret_hash
      RETURNING player.id
    ),
    promoted_candidate AS (
      UPDATE install_recovery_candidates AS candidate
      SET status = 'promoted', promoted_at = NOW()
      FROM selected, promoted_player
      WHERE candidate.id = selected.id
      RETURNING candidate.*
    ),
    upserted AS (
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
    ),
    recovery_event AS (
      INSERT INTO install_recovery_events
        (candidate_id, player_id, event_type, actor, reason, created_at)
      SELECT promoted_candidate.id,
             promoted_candidate.player_id,
             'promoted',
             ${actor},
             ${reason ?? null},
             NOW()
      FROM promoted_candidate
    )
    SELECT promoted_candidate.id AS candidate_id,
           promoted_candidate.player_id,
           COALESCE((SELECT array_agg(upserted.boss) FROM upserted), ARRAY[]::text[]) AS changed_bosses
    FROM promoted_candidate
  `);

  const promoted = result.rows[0];
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
    ...promoted.changed_bosses.flatMap((boss) => [bossCacheTag(boss), profileBossBucketCacheTag(boss)]),
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
  const result = await db.execute<{ candidate_id: number; player_id: number }>(sql`
    WITH rejected AS (
      UPDATE install_recovery_candidates
      SET status = 'rejected', rejected_at = NOW()
      WHERE id = ${candidateId} AND status IN ('pending', 'invalidation_failed', 'contested')
      RETURNING id, player_id
    ),
    recovery_event AS (
      INSERT INTO install_recovery_events
        (candidate_id, player_id, event_type, actor, reason, created_at)
      SELECT rejected.id, rejected.player_id, 'rejected', ${actor}, ${reason ?? null}, NOW()
      FROM rejected
    )
    SELECT rejected.id AS candidate_id, rejected.player_id
    FROM rejected
  `);

  const rejected = result.rows[0];
  if (!rejected) {
    throw new RecoveryDecisionConflictError('Recovery candidate is no longer pending or contested.');
  }
  return { candidateId: rejected.candidate_id, playerId: rejected.player_id };
}
