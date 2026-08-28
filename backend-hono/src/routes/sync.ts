import { and, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../db/client.js';
import { personalBests, playerInstallCredentials, players, syncAttempts } from '../db/schema.js';
import {
  bossCacheTag,
  cacheTags,
  invalidateSharedCache,
  playerIdCacheTag,
  playerNameCacheTag,
  profileBossBucketCacheTag,
  profileBossExactCacheTag,
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
    // The account row and its first authorized install are claimed in one
    // transaction. If two first-ever syncs race, only the secret that won the
    // account insert is seeded; the loser is handled as an unknown candidate.
    const [insertedRows, , claimedRows] = await db.$client.transaction((txn) => [
      txn(
        `INSERT INTO players
           (account_hash, display_name, display_name_lower, install_secret_hash, updated_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (account_hash) DO NOTHING
         RETURNING id`,
        [accountHash, displayName, displayNameLower, secretHash]
      ),
      txn(
        `INSERT INTO player_install_credentials
           (player_id, secret_hash, status, source, first_seen_at, last_seen_at, authorized_at)
         SELECT id, $2, 'active', 'initial_sync', NOW(), NOW(), NOW()
         FROM players
         WHERE account_hash = $1 AND install_secret_hash = $2
         ON CONFLICT (player_id, secret_hash) DO NOTHING`,
        [accountHash, secretHash]
      ),
      txn(
        `SELECT player.id, player.display_name, player.display_name_lower,
                player.install_secret_hash,
                EXISTS (
                  SELECT 1 FROM player_install_credentials AS credential
                  WHERE credential.player_id = player.id
                    AND credential.secret_hash = $2
                    AND credential.status = 'active'
                ) AS authorized
         FROM players AS player
         WHERE player.account_hash = $1
         LIMIT 1`,
        [accountHash, secretHash]
      ),
    ]);
    const claimed = claimedRows[0];
    if (!claimed) {
      throw new Error('Unable to resolve player after initial install claim.');
    }
    if (!Boolean(claimed.authorized)) {
      return {
        playerId: Number(claimed.id),
        authorized: false,
        metadataChanged: false,
        created: false,
        bindingStatus: null as 'active' | 'revoked' | null,
        incumbentSecretHash: String(claimed.install_secret_hash),
        namesToInvalidate: [] as string[],
      };
    }
    return {
      playerId: Number(claimed.id),
      authorized: true,
      metadataChanged: true,
      created: insertedRows.length > 0,
      bindingStatus: 'active' as const,
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

  // Seed the legacy binding lazily as well as through the migration. This
  // makes rolling deploys safe if a player row appears between the migration's
  // data copy and the new code becoming active. ON CONFLICT deliberately does
  // not reactivate a credential an operator explicitly revoked.
  if (incumbentSecretHash) {
    const now = new Date();
    await db
      .insert(playerInstallCredentials)
      .values({
        playerId: existing.id,
        secretHash: incumbentSecretHash,
        status: 'active',
        source: 'legacy',
        firstSeenAt: now,
        lastSeenAt: now,
        authorizedAt: now,
      })
      .onConflictDoNothing({
        target: [playerInstallCredentials.playerId, playerInstallCredentials.secretHash],
      });
  }

  const [installBinding] = await db
    .select({ id: playerInstallCredentials.id, status: playerInstallCredentials.status })
    .from(playerInstallCredentials)
    .where(
      and(
        eq(playerInstallCredentials.playerId, existing.id),
        eq(playerInstallCredentials.secretHash, secretHash)
      )
    )
    .limit(1);

  if (!installBinding || installBinding.status !== 'active') {
    return {
      playerId: existing.id,
      authorized: false,
      metadataChanged: false,
      created: false,
      bindingStatus:
        installBinding?.status === 'revoked' ? 'revoked' as const : null,
      incumbentSecretHash,
      namesToInvalidate: [] as string[],
    };
  }

  return {
    playerId: existing.id,
    authorized: true,
    metadataChanged: existing.displayName !== displayName,
    created: false,
    bindingStatus: 'active' as const,
    incumbentSecretHash,
    namesToInvalidate:
      existing.displayName === displayName
        ? [] as string[]
        : [existing.displayNameLower, displayNameLower],
  };
}

export async function isSuccessfulSyncReplayAuthorized(values: {
  accountHash: string;
  playerId: number;
  secretHash: string;
}) {
  // Replay is only an optimization. The database credential binding remains
  // authoritative, so take the same player-first lock used by revoke and
  // reactivate before accepting a cached success. Two statements are
  // intentional: after waiting for the player lock, READ COMMITTED gives the
  // credential query a fresh snapshot that includes the completed operator
  // action. Holding the player lock also prevents every credential lifecycle
  // action from racing the fresh credential-status read before this
  // transaction commits, so the second query deliberately needs no row lock.
  const [playerRows, credentialRows] = await db.$client.transaction((txn) => [
    txn(
      `SELECT id
       FROM players
       WHERE id = $1 AND account_hash = $2
       FOR SHARE`,
      [values.playerId, values.accountHash]
    ),
    txn(
      `SELECT id
       FROM player_install_credentials
       WHERE player_id = $1 AND secret_hash = $2 AND status = 'active'`,
      [values.playerId, values.secretHash]
    ),
  ]);
  return playerRows.length === 1 && credentialRows.length === 1;
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
      `SELECT player.id
       FROM players AS player
       JOIN player_install_credentials AS credential
         ON credential.player_id = player.id
        AND credential.secret_hash = $2
        AND credential.status = 'active'
       WHERE player.id = $1
       FOR UPDATE OF player, credential`,
      [values.playerId, values.secretHash]
    ),
    txn(
      `INSERT INTO player_name_history
         (player_id, display_name, display_name_lower, created_at)
       SELECT player.id, player.display_name, player.display_name_lower, NOW()
       FROM players AS player
       JOIN player_install_credentials AS credential
         ON credential.player_id = player.id
        AND credential.secret_hash = $2
        AND credential.status = 'active'
       WHERE player.id = $1 AND player.display_name <> $3
       ON CONFLICT DO NOTHING`,
      [values.playerId, values.secretHash, values.displayName]
    ),
    txn(
      `WITH current AS MATERIALIZED (
         SELECT player.id, player.display_name_lower
         FROM players AS player
         JOIN player_install_credentials AS credential
           ON credential.player_id = player.id
          AND credential.secret_hash = $2
          AND credential.status = 'active'
         WHERE player.id = $1 AND player.display_name <> $3
       )
       UPDATE players
       SET display_name = $3, display_name_lower = $4, updated_at = NOW()
       FROM current
       WHERE players.id = current.id
       RETURNING current.display_name_lower AS old_display_name_lower`,
      [values.playerId, values.secretHash, values.displayName, values.displayNameLower]
    ),
    txn(
      `UPDATE player_install_credentials
       SET last_seen_at = NOW()
       WHERE player_id = $1 AND secret_hash = $2 AND status = 'active'`,
      [values.playerId, values.secretHash]
    ),
    txn(
      `WITH incoming AS (
         SELECT key AS boss, value::real AS time_seconds
         FROM jsonb_each_text($3::jsonb)
       ), authorized AS (
         SELECT player.id
         FROM players AS player
         JOIN player_install_credentials AS credential
           ON credential.player_id = player.id
          AND credential.secret_hash = $2
          AND credential.status = 'active'
         WHERE player.id = $1
       )
       INSERT INTO personal_bests (player_id, boss, time_seconds, updated_at)
       SELECT authorized.id, incoming.boss, incoming.time_seconds, NOW()
       FROM authorized CROSS JOIN incoming
       ON CONFLICT (player_id, boss) DO UPDATE
         SET time_seconds = EXCLUDED.time_seconds, updated_at = EXCLUDED.updated_at
         WHERE EXCLUDED.time_seconds < personal_bests.time_seconds
       RETURNING boss, (xmax = 0) AS inserted`,
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
    insertedBosses: [
      ...new Set(changedRows.filter((row) => Boolean(row.inserted)).map((row) => String(row.boss))),
    ],
    improvedBosses: [
      ...new Set(changedRows.filter((row) => !Boolean(row.inserted)).map((row) => String(row.boss))),
    ],
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
export async function upsertPbs(playerId: number, pbsByBoss: Map<string, number>) {
  if (pbsByBoss.size === 0) {
    return { insertedBosses: [] as string[], improvedBosses: [] as string[] };
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
    .returning({
      boss: personalBests.boss,
      // xmax is a Postgres system column: 0 if this row was inserted by the
      // current command, non-zero if an existing row was updated instead.
      // Used to tell "brand-new boss" apart from "existing PB improved" so
      // the caller can invalidate the global stats cache only on the former.
      inserted: sql<boolean>`xmax = 0`,
    });

  const insertedBosses = new Set<string>();
  const improvedBosses = new Set<string>();
  for (const row of changed) {
    (row.inserted ? insertedBosses : improvedBosses).add(row.boss);
  }

  return {
    insertedBosses: [...insertedBosses],
    improvedBosses: [...improvedBosses],
  };
}

// Must run before upsertPbs's insert, not after - see the race analysis in
// this task's code review. Checking existence before this sync's own write
// (rather than counting rows after) means a genuine race between two
// concurrent first-ever syncers for the same boss key both correctly see
// "didn't exist yet" and both invalidate (a harmless duplicate purge) -
// instead of the previous shape, where both could see "already exists"
// (each other's just-committed row) and NEITHER would invalidate, silently
// missing a truly new boss until the CDN entry's TTL naturally expires.
async function findAlreadyKnownBosses(bossKeys: readonly string[]): Promise<Set<string>> {
  if (bossKeys.length === 0) {
    return new Set();
  }

  const rows = await db
    .selectDistinct({ boss: personalBests.boss })
    .from(personalBests)
    .where(inArray(personalBests.boss, bossKeys));

  return new Set(rows.map((row) => row.boss));
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

  if (replay && await isSuccessfulSyncReplayAuthorized({
    accountHash,
    playerId: replay.playerId,
    secretHash,
  })) {
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
    bindingStatus,
    incumbentSecretHash,
    namesToInvalidate,
  } = await resolvePlayer(accountHash, displayName, secretHash);

  if (!authorized) {
    if (bindingStatus === 'revoked') {
      const syncAttemptId = await recordSyncAttempt({
        playerId,
        outcome: 'install_secret_mismatch',
        httpStatus: 409,
        receivedCount: entries.length,
        eligibleCount: pbsByBoss.size,
      });
      return c.json(
        {
          error: 'This installation has been revoked for this account.',
          code: 'RECOVERY_REJECTED',
          recoveryId: null,
          retryAfterSeconds: 900,
          syncAttemptId,
        },
        409
      );
    }

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
        error: 'This installation is not yet authorized for this account.',
        code,
        recoveryId: recoveryCandidate?.id ?? null,
        retryAfterSeconds: recoveryCandidate ? 900 : null,
        syncAttemptId,
      },
      409
    );
  }

  // Read before this sync's insert so a genuinely new global boss can never
  // be mistaken for an existing one. Concurrent first insertions may both
  // invalidate, which is the safe direction for cache correctness.
  const alreadyKnownBosses = await findAlreadyKnownBosses([...pbsByBoss.keys()]);
  const committed = created
    ? {
        authorized: true,
        metadataChanged,
        namesToInvalidate,
        ...(await upsertPbs(playerId, pbsByBoss)),
      }
    : await commitExistingAuthorizedSync({
        playerId,
        secretHash,
        displayName,
        displayNameLower: displayName.toLowerCase(),
        pbsByBoss,
      });

  // An operator may have revoked or replaced this installation after the
  // initial lookup.
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
        error: 'This installation is no longer authorized for this account.',
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
  const { insertedBosses, improvedBosses } = committed;
  const changedBosses = [...insertedBosses, ...improvedBosses];
  const globallyNewBosses = new Set(insertedBosses.filter((boss) => !alreadyKnownBosses.has(boss)));
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

  // stats: a new player OR any PB insertion, not a faster-time-only update.
  if (created || insertedBosses.length > 0) {
    invalidationTags.push(cacheTags.stats);
  }

  // bossList/search: only when the first-ever PB for a previously-absent
  // boss key is inserted, not for a player's own first time on a boss key
  // that already exists elsewhere in the database.
  if (globallyNewBosses.size > 0) {
    invalidationTags.push(cacheTags.bossList, cacheTags.search);
  }

  // Per-boss/profile/player tags: both insertion and improvement change the
  // boss leaderboard and this player's rank-bearing profile. Both the exact
  // and bucket tag are invalidated for each boss (not just whichever scheme
  // players.ts happens to be using for a given profile right now) so a
  // rolling deploy or an oversized (bucket-fallback) profile can never be
  // left stale depending on which scheme actually tagged its cached
  // response - see players.ts's profileCacheTags for the exact/bucket
  // selection this pairs with.
  if (changedBosses.length > 0) {
    invalidationTags.push(
      playerIdCacheTag(playerId),
      ...changedBosses.flatMap((boss) => [
        bossCacheTag(boss),
        profileBossExactCacheTag(boss),
        profileBossBucketCacheTag(boss),
      ])
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
