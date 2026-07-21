import { createHash } from 'node:crypto';
import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  installRecoveryCandidates,
  installRecoveryEvents,
  personalBests,
} from '../db/schema.js';
import {
  bossCacheTag,
  cacheTags,
  invalidateSharedCache,
  playerIdCacheTag,
  profileBossBucketCacheTag,
} from './cache.js';

const RECOVERABLE_STATUSES = ['pending', 'contested'] as const;

export type RecoveryCandidateStatus = 'pending' | 'contested' | 'promoted' | 'rejected';

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

export async function listSafeInstallRecoveryCandidates() {
  return db
    .select(safeRecoveryCandidateColumns)
    .from(installRecoveryCandidates)
    .orderBy(desc(installRecoveryCandidates.lastSeenAt));
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

async function continuityFor(playerId: number, pbsByBoss: Map<string, number>): Promise<RecoveryContinuity> {
  const stored = await db
    .select({ boss: personalBests.boss, timeSeconds: personalBests.timeSeconds })
    .from(personalBests)
    .where(eq(personalBests.playerId, playerId));
  const storedByBoss = new Map(stored.map((pb) => [pb.boss, pb.timeSeconds]));

  let equalCount = 0;
  let improvedCount = 0;
  let newCount = 0;
  let slowerCount = 0;
  for (const [boss, timeSeconds] of pbsByBoss) {
    const previous = storedByBoss.get(boss);
    if (previous === undefined) {
      newCount += 1;
    } else if (Math.abs(previous - timeSeconds) < 0.001) {
      equalCount += 1;
    } else if (timeSeconds < previous) {
      improvedCount += 1;
    } else {
      slowerCount += 1;
    }
  }

  return {
    equalCount,
    improvedCount,
    newCount,
    slowerCount,
    missingCount: stored.filter((pb) => !pbsByBoss.has(pb.boss)).length,
  };
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
  const continuity = await continuityFor(values.playerId, values.pbsByBoss);

  const [candidate] = await db
    .insert(installRecoveryCandidates)
    .values({
      playerId: values.playerId,
      incumbentSecretHash: values.incumbentSecretHash,
      candidateSecretHash: values.candidateSecretHash,
      displayName: values.displayName,
      payload,
      payloadDigest: payloadDigest(payload),
      receivedCount: values.receivedCount,
      eligibleCount: values.pbsByBoss.size,
      ...continuity,
      firstSeenAt: now,
      lastSeenAt: now,
    })
    .onConflictDoUpdate({
      target: [
        installRecoveryCandidates.playerId,
        installRecoveryCandidates.incumbentSecretHash,
        installRecoveryCandidates.candidateSecretHash,
      ],
      set: {
        displayName: values.displayName,
        payload,
        payloadDigest: payloadDigest(payload),
        attemptCount: sql`${installRecoveryCandidates.attemptCount} + 1`,
        receivedCount: values.receivedCount,
        eligibleCount: values.pbsByBoss.size,
        ...continuity,
        lastSeenAt: now,
      },
    })
    .returning();

  let status = candidate.status as RecoveryCandidateStatus;
  if (RECOVERABLE_STATUSES.includes(status as (typeof RECOVERABLE_STATUSES)[number])) {
    const competing = await db
      .select({ id: installRecoveryCandidates.id })
      .from(installRecoveryCandidates)
      .where(
        and(
          eq(installRecoveryCandidates.playerId, values.playerId),
          ne(installRecoveryCandidates.id, candidate.id),
          inArray(installRecoveryCandidates.status, [...RECOVERABLE_STATUSES])
        )
      )
      .limit(1);

    if (competing.length > 0) {
      await db
        .update(installRecoveryCandidates)
        .set({ status: 'contested' })
        .where(
          and(
            eq(installRecoveryCandidates.playerId, values.playerId),
            inArray(installRecoveryCandidates.status, [...RECOVERABLE_STATUSES])
          )
        );
      status = 'contested';
    }
  }

  return {
    id: candidate.id,
    status,
    attemptCount: candidate.attemptCount,
    receivedCount: candidate.receivedCount,
    eligibleCount: candidate.eligibleCount,
    equalCount: candidate.equalCount,
    improvedCount: candidate.improvedCount,
    newCount: candidate.newCount,
    slowerCount: candidate.slowerCount,
    missingCount: candidate.missingCount,
    firstSeenAt: candidate.firstSeenAt,
    lastSeenAt: candidate.lastSeenAt,
  };
}

export async function noteIncumbentCredentialSeen(playerId: number) {
  const transitioned = await db
    .update(installRecoveryCandidates)
    .set({ status: 'contested' })
    .where(
      and(
        eq(installRecoveryCandidates.playerId, playerId),
        eq(installRecoveryCandidates.status, 'pending')
      )
    )
    .returning({ id: installRecoveryCandidates.id });

  if (transitioned.length > 0) {
    await db.insert(installRecoveryEvents).values(
      transitioned.map((candidate) => ({
        candidateId: candidate.id,
        playerId,
        eventType: 'incumbent_seen',
        actor: 'system',
        reason: 'The incumbent credential synced while recovery was pending.',
        createdAt: new Date(),
      }))
    );
  }
}

export class RecoveryDecisionConflictError extends Error {}

export async function promoteInstallRecoveryCandidate(candidateId: number, actor: string, reason?: string) {
  const result = await db.execute<{
    candidate_id: number;
    player_id: number;
    changed_bosses: string[];
  }>(sql`
    WITH selected AS (
      SELECT *
      FROM install_recovery_candidates
      WHERE id = ${candidateId} AND status = 'pending'
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
      WHERE id = ${candidateId} AND status IN ('pending', 'contested')
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
