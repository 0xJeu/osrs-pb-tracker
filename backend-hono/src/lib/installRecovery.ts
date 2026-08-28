import { createHash } from 'node:crypto';
import { desc, eq, inArray, lt } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  installRecoveryCandidates,
  installRecoveryEvents,
  playerInstallCredentials,
} from '../db/schema.js';
import { invalidatePlayerSyncReplay } from './syncReplay.js';

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

const safeInstallCredentialColumns = {
  id: playerInstallCredentials.id,
  playerId: playerInstallCredentials.playerId,
  status: playerInstallCredentials.status,
  source: playerInstallCredentials.source,
  authorizedFromCandidateId: playerInstallCredentials.authorizedFromCandidateId,
  firstSeenAt: playerInstallCredentials.firstSeenAt,
  lastSeenAt: playerInstallCredentials.lastSeenAt,
  authorizedAt: playerInstallCredentials.authorizedAt,
  revokedAt: playerInstallCredentials.revokedAt,
} as const;

async function attachSafeInstallEvidence<
  T extends { playerId: number }
>(candidates: T[]) {
  const playerIds = [...new Set(candidates.map((candidate) => candidate.playerId))];
  const installs = playerIds.length === 0
    ? []
    : await db
        .select(safeInstallCredentialColumns)
        .from(playerInstallCredentials)
        .where(inArray(playerInstallCredentials.playerId, playerIds))
        .orderBy(desc(playerInstallCredentials.lastSeenAt));
  const byPlayer = new Map<number, typeof installs>();
  for (const install of installs) {
    const entries = byPlayer.get(install.playerId) ?? [];
    entries.push(install);
    byPlayer.set(install.playerId, entries);
  }
  return candidates.map((candidate) => {
    const playerInstalls = byPlayer.get(candidate.playerId) ?? [];
    return {
      ...candidate,
      activeInstallCount: playerInstalls.filter((install) => install.status === 'active').length,
      installations: playerInstalls,
    };
  });
}

export async function listSafeInstallRecoveryCandidates(options?: {
  statuses?: readonly RecoveryCandidateStatus[];
  limit?: number;
}) {
  const statusFilter = options?.statuses?.length
    ? inArray(installRecoveryCandidates.status, [...options.statuses])
    : undefined;
  const candidates = await db
    .select(safeRecoveryCandidateColumns)
    .from(installRecoveryCandidates)
    .where(statusFilter)
    .orderBy(desc(installRecoveryCandidates.lastSeenAt))
    .limit(options?.limit ?? 1_000);
  return attachSafeInstallEvidence(candidates);
}

export async function getSafeInstallRecoveryCandidate(candidateId: number) {
  const [candidate] = await db
    .select(safeRecoveryCandidateColumns)
    .from(installRecoveryCandidates)
    .where(eq(installRecoveryCandidates.id, candidateId))
    .limit(1);
  if (!candidate) return null;
  return (await attachSafeInstallEvidence([candidate]))[0];
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
  // sync commits and operator decisions. Candidate upsert, continuity calculation, and
  // competing-candidate contestation therefore commit as one ordered action.
  const [lockedRows, , , finalRows] = await db.$client.transaction((txn) => [
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
       SELECT admitted.id, $2, $3, 'pending', $4, $5::jsonb, $6, $7, $8,
              continuity.equal_count, continuity.improved_count,
              continuity.new_count, continuity.slower_count,
              missing.missing_count, $9, $9
       FROM admitted CROSS JOIN continuity CROSS JOIN missing
       ON CONFLICT (player_id, incumbent_secret_hash, candidate_secret_hash)
       DO UPDATE SET
         status = CASE
           WHEN install_recovery_candidates.status IN ('invalidation_pending', 'invalidation_failed')
             THEN 'pending'
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
  const status = String(candidate.status) as RecoveryCandidateStatus;

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

export class RecoveryDecisionConflictError extends Error {}

export class RecoveryCandidateLimitError extends Error {}

export async function promoteInstallRecoveryCandidate(
  candidateId: number,
  actor: string,
  reason?: string,
  mode: 'additional' | 'replace' = 'additional'
) {
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
       ), authorized_install AS (
         INSERT INTO player_install_credentials (
           player_id, secret_hash, status, source, authorized_from_candidate_id,
           authorized_by, first_seen_at, last_seen_at, authorized_at
         )
         SELECT candidate.player_id, candidate.candidate_secret_hash, 'active',
                CASE WHEN $4 = 'replace' THEN 'recovery_replace' ELSE 'recovery_additional' END,
                candidate.id, $2, candidate.first_seen_at, candidate.last_seen_at, NOW()
         FROM candidate
         ON CONFLICT (player_id, secret_hash) DO NOTHING
         RETURNING id, player_id, secret_hash
       ), revoked_installs AS (
         UPDATE player_install_credentials AS credential
         SET status = 'revoked', revoked_at = NOW(), revoked_by = $2
         FROM authorized_install
         WHERE $4 = 'replace'
           AND credential.player_id = authorized_install.player_id
           AND credential.id <> authorized_install.id
           AND credential.status = 'active'
         RETURNING credential.id, credential.player_id
       ), legacy_anchor AS (
         UPDATE players AS player
         SET install_secret_hash = authorized_install.secret_hash
         FROM authorized_install
         WHERE $4 = 'replace' AND player.id = authorized_install.player_id
         RETURNING player.id
       ), promoted_candidate AS (
         UPDATE install_recovery_candidates AS stored_candidate
         SET status = 'promoted', promoted_at = NOW()
         FROM candidate, authorized_install
         WHERE stored_candidate.id = candidate.id
           AND stored_candidate.status = 'pending'
         RETURNING stored_candidate.*
       ), recovery_event AS (
         INSERT INTO install_recovery_events
           (candidate_id, player_id, event_type, actor, reason, created_at)
         SELECT promoted_candidate.id,
                promoted_candidate.player_id,
                CASE WHEN $4 = 'replace' THEN 'authorized_replace' ELSE 'authorized_additional' END,
                $2, $3, NOW()
         FROM promoted_candidate
       ), install_event AS (
         INSERT INTO player_install_credential_events
           (credential_id, player_id, event_type, actor, reason, created_at)
         SELECT authorized_install.id, authorized_install.player_id,
                CASE WHEN $4 = 'replace' THEN 'authorized_replace' ELSE 'authorized_additional' END,
                $2, $3, NOW()
         FROM authorized_install
       ), revoked_events AS (
         INSERT INTO player_install_credential_events
           (credential_id, player_id, event_type, actor, reason, created_at)
         SELECT revoked_installs.id, revoked_installs.player_id,
                'revoked_by_replacement', $2, $3, NOW()
         FROM revoked_installs
       ), closed_candidates AS (
         UPDATE install_recovery_candidates AS prior_candidate
         SET status = 'rejected', rejected_at = NOW()
         FROM revoked_installs, player_install_credentials AS revoked_credential
         WHERE revoked_credential.id = revoked_installs.id
           AND prior_candidate.id = revoked_credential.authorized_from_candidate_id
           AND prior_candidate.status = 'promoted'
         RETURNING prior_candidate.id, prior_candidate.player_id
       ), closed_candidate_events AS (
         INSERT INTO install_recovery_events
           (candidate_id, player_id, event_type, actor, reason, created_at)
         SELECT id, player_id, 'credential_revoked_by_replacement', $2, $3, NOW()
         FROM closed_candidates
       )
       SELECT promoted_candidate.id AS candidate_id,
              promoted_candidate.player_id,
              (SELECT COUNT(*)::int FROM revoked_installs) AS revoked_install_count
       FROM promoted_candidate`,
      [candidateId, actor, reason ?? null, mode]
    ),
  ]);

  const promoted = promotedRows[0] as
    | {
        candidate_id: number;
        player_id: number;
        revoked_install_count: number;
      }
    | undefined;
  if (!promoted) {
    throw new RecoveryDecisionConflictError(
      'Recovery candidate is no longer pending, conflicts with another candidate, or is already authorized.'
    );
  }

  // Replacement revokes old credentials, so their successful replay entries
  // must be evicted. Additional authorization intentionally preserves every
  // existing installation and therefore leaves their replay entries intact.
  if (mode === 'replace') {
    await invalidatePlayerSyncReplay(promoted.player_id);
  }

  return {
    candidateId: promoted.candidate_id,
    playerId: promoted.player_id,
    // Approval never applies the mutable quarantined payload. The newly
    // authorized plugin must retry through the normal faster-only sync path,
    // closing the review/approval TOCTOU window.
    changedBosses: [] as string[],
    mode,
    revokedInstallCount: Number(promoted.revoked_install_count),
  };
}

export async function revokePlayerInstallCredential(
  credentialId: number,
  actor: string,
  reason: string
) {
  const [, revokedRows] = await db.$client.transaction((txn) => [
    txn(
      `SELECT player.id
       FROM players AS player
       JOIN player_install_credentials AS credential ON credential.player_id = player.id
       WHERE credential.id = $1
       FOR UPDATE OF player`,
      [credentialId]
    ),
    txn(
      `WITH target AS MATERIALIZED (
         SELECT credential.id, credential.player_id, credential.secret_hash
         FROM player_install_credentials AS credential
         WHERE credential.id = $1
           AND credential.status = 'active'
           AND (
             SELECT COUNT(*)
             FROM player_install_credentials AS active
             WHERE active.player_id = credential.player_id AND active.status = 'active'
           ) > 1
       ), revoked AS (
         UPDATE player_install_credentials AS credential
         SET status = 'revoked', revoked_at = NOW(), revoked_by = $2
         FROM target
         WHERE credential.id = target.id AND credential.status = 'active'
         RETURNING credential.id, credential.player_id, credential.secret_hash,
                   credential.authorized_from_candidate_id
       ), install_event AS (
         INSERT INTO player_install_credential_events
           (credential_id, player_id, event_type, actor, reason, created_at)
         SELECT revoked.id, revoked.player_id, 'revoked', $2, $3, NOW()
         FROM revoked
       ), closed_candidate AS (
         UPDATE install_recovery_candidates AS candidate
         SET status = 'rejected', rejected_at = NOW()
         FROM revoked
         WHERE candidate.id = revoked.authorized_from_candidate_id
           AND candidate.status = 'promoted'
         RETURNING candidate.id, candidate.player_id
       ), recovery_event AS (
         INSERT INTO install_recovery_events
           (candidate_id, player_id, event_type, actor, reason, created_at)
         SELECT id, player_id, 'credential_revoked', $2, $3, NOW()
         FROM closed_candidate
       )
       SELECT revoked.id AS credential_id, revoked.player_id
       FROM revoked`,
      [credentialId, actor, reason]
    ),
  ]);

  const revoked = revokedRows[0] as { credential_id: number; player_id: number } | undefined;
  if (!revoked) {
    throw new RecoveryDecisionConflictError(
      'Installation is no longer active or it is the player\'s only active installation.'
    );
  }
  await invalidatePlayerSyncReplay(revoked.player_id);
  return { credentialId: revoked.credential_id, playerId: revoked.player_id };
}

export async function reactivatePlayerInstallCredential(
  credentialId: number,
  actor: string,
  reason: string
) {
  const [, reactivatedRows] = await db.$client.transaction((txn) => [
    txn(
      `SELECT player.id
       FROM players AS player
       JOIN player_install_credentials AS credential ON credential.player_id = player.id
       WHERE credential.id = $1
       FOR UPDATE OF player`,
      [credentialId]
    ),
    txn(
      `WITH target AS MATERIALIZED (
         SELECT credential.id, credential.player_id, credential.secret_hash
         FROM player_install_credentials AS credential
         WHERE credential.id = $1 AND credential.status = 'revoked'
       ), matching_candidate AS MATERIALIZED (
         SELECT candidate.id, candidate.player_id
         FROM install_recovery_candidates AS candidate
         JOIN target ON target.player_id = candidate.player_id
                    AND target.secret_hash = candidate.candidate_secret_hash
         WHERE candidate.status IN (
           'invalidation_pending', 'pending', 'invalidation_failed', 'contested', 'rejected'
         )
         ORDER BY candidate.last_seen_at DESC, candidate.id DESC
         LIMIT 1
       ), reactivated AS (
         UPDATE player_install_credentials AS credential
         SET status = 'active', revoked_at = NULL, revoked_by = NULL,
             authorized_at = NOW(), authorized_by = $2,
             authorized_from_candidate_id = COALESCE(
               (SELECT id FROM matching_candidate),
               credential.authorized_from_candidate_id
             )
         FROM target
         WHERE credential.id = target.id AND credential.status = 'revoked'
         RETURNING credential.id, credential.player_id
       ), promoted_candidate AS (
         UPDATE install_recovery_candidates AS candidate
         SET status = 'promoted', promoted_at = NOW(), rejected_at = NULL
         FROM matching_candidate, reactivated
         WHERE candidate.id = matching_candidate.id
         RETURNING candidate.id, candidate.player_id
       ), install_event AS (
         INSERT INTO player_install_credential_events
           (credential_id, player_id, event_type, actor, reason, created_at)
         SELECT id, player_id, 'reactivated', $2, $3, NOW()
         FROM reactivated
       ), recovery_event AS (
         INSERT INTO install_recovery_events
           (candidate_id, player_id, event_type, actor, reason, created_at)
         SELECT id, player_id, 'credential_reactivated', $2, $3, NOW()
         FROM promoted_candidate
       )
       SELECT reactivated.id AS credential_id, reactivated.player_id,
              (SELECT id FROM promoted_candidate LIMIT 1) AS candidate_id
       FROM reactivated`,
      [credentialId, actor, reason]
    ),
  ]);

  const reactivated = reactivatedRows[0] as
    | { credential_id: number; player_id: number; candidate_id: number | null }
    | undefined;
  if (!reactivated) {
    throw new RecoveryDecisionConflictError('Installation is no longer revoked.');
  }
  await invalidatePlayerSyncReplay(reactivated.player_id);
  return {
    credentialId: reactivated.credential_id,
    playerId: reactivated.player_id,
    candidateId: reactivated.candidate_id,
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
 * Explicitly reverses an operator rejection or retires a legacy replay-
 * invalidation gate without authorizing the install or applying its
 * quarantined submission. If another unknown credential is
 * currently active in the queue, the reopened candidate becomes contested so
 * the ordinary contest-resolution gate still applies.
 */
export async function reopenRejectedInstallRecoveryCandidate(
  candidateId: number,
  actor: string,
  reason: string
) {
  const [, reopenedRows] = await db.$client.transaction((txn) => [
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
         SELECT candidate.id, candidate.player_id
         FROM install_recovery_candidates AS candidate
         JOIN players AS player ON player.id = candidate.player_id
         WHERE candidate.id = $1
           AND candidate.status IN ('rejected', 'invalidation_pending', 'invalidation_failed')
           AND player.install_secret_hash = candidate.incumbent_secret_hash
       ), reopened AS (
         UPDATE install_recovery_candidates AS candidate
         SET status = CASE WHEN EXISTS (
               SELECT 1
               FROM install_recovery_candidates AS competing
               WHERE competing.player_id = selected.player_id
                 AND competing.id <> selected.id
                 AND competing.status IN (
                   'invalidation_pending', 'pending', 'invalidation_failed', 'contested'
                 )
             ) THEN 'contested' ELSE 'pending' END,
             rejected_at = NULL
         FROM selected
         WHERE candidate.id = selected.id
           AND candidate.status IN ('rejected', 'invalidation_pending', 'invalidation_failed')
         RETURNING candidate.id, candidate.player_id, candidate.status
       ), contest_competitors AS (
         UPDATE install_recovery_candidates AS competitor
         SET status = 'contested'
         FROM reopened
         WHERE reopened.status = 'contested'
           AND competitor.player_id = reopened.player_id
           AND competitor.id <> reopened.id
           AND competitor.status IN ('invalidation_pending', 'pending', 'invalidation_failed')
         RETURNING competitor.id
       ), recovery_event AS (
         INSERT INTO install_recovery_events
           (candidate_id, player_id, event_type, actor, reason, created_at)
         SELECT id, player_id,
                CASE WHEN status = 'contested' THEN 'reopened_contested' ELSE 'reopened' END,
                $2, $3, NOW()
         FROM reopened
       )
       SELECT reopened.id AS candidate_id, reopened.player_id, reopened.status
       FROM reopened`,
      [candidateId, actor, reason]
    ),
  ]);

  const reopened = reopenedRows[0] as
    | { candidate_id: number; player_id: number; status: RecoveryCandidateStatus }
    | undefined;
  if (!reopened) {
    throw new RecoveryDecisionConflictError(
      'Recovery candidate cannot be reopened or belongs to an obsolete credential epoch.'
    );
  }
  return {
    candidateId: reopened.candidate_id,
    playerId: reopened.player_id,
    status: reopened.status,
  };
}

/**
 * Resolves a contested credential epoch without changing the player's bound
 * install credential. The operator chooses the candidate identified through
 * support, every competing active candidate from the same incumbent epoch is
 * rejected, and the chosen candidate returns to pending for a separate,
 * deliberate authorization decision.
 *
 * Keeping resolution and authorization separate is intentional: resolving a
 * contest is not itself proof that the unknown credential should be added.
 * Only another competing unknown candidate creates a new contest; activity
 * from an already-authorized installation is normal in the multi-install
 * model.
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
