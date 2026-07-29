import { eq, inArray, lt, sql } from 'drizzle-orm';
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
  profileBossExactCacheTag,
} from '../lib/cache.js';
import { hashSecret, isRateLimited } from '../lib/secret.js';
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
}) {
  try {
    const [attempt] = await db
      .insert(syncAttempts)
      .values({
        ...values,
        eligibleCount: values.eligibleCount ?? null,
        updatedCount: values.updatedCount ?? null,
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
    namesToInvalidate,
  };
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

  const { playerId, authorized, metadataChanged, created, namesToInvalidate } = await upsertPlayer(
    accountHash,
    displayName,
    secretHash
  );

  if (!authorized) {
    const syncAttemptId = await recordSyncAttempt({
      playerId,
      outcome: 'install_secret_mismatch',
      httpStatus: 409,
      receivedCount: entries.length,
    });
    return c.json(
      {
        error:
          'This account is already synced from a different install. If this is really you, the original install secret is required.',
        syncAttemptId,
      },
      409
    );
  }

  const pbsByBoss = new Map<string, number>();
  for (const [rawBoss, seconds] of entries) {
    const boss = rawBoss.trim().toLowerCase();
    const timeSeconds = Number(seconds);
    if (!boss || !Number.isFinite(timeSeconds) || timeSeconds <= 0) {
      continue;
    }
    if (!isTrackedBoss(boss)) {
      continue;
    }
    if (isRedundantDuplicateKey(boss)) {
      continue;
    }

    // Different raw keys can normalize to the same boss. Keep the fastest so
    // one batched INSERT never attempts to affect the same conflict row twice.
    const pendingTime = pbsByBoss.get(boss);
    if (pendingTime === undefined || timeSeconds < pendingTime) {
      pbsByBoss.set(boss, timeSeconds);
    }
  }

  const alreadyKnownBosses = await findAlreadyKnownBosses([...pbsByBoss.keys()]);
  const { insertedBosses, improvedBosses } = await upsertPbs(playerId, pbsByBoss);
  const changedBosses = [...insertedBosses, ...improvedBosses];
  const globallyNewBosses = new Set(insertedBosses.filter((boss) => !alreadyKnownBosses.has(boss)));
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

  // search: a new player, a rename, or a first-ever boss key.
  if (metadataChanged) {
    invalidationTags.push(
      cacheTags.search,
      cacheTags.recentSyncs,
      playerIdCacheTag(playerId),
      ...namesToInvalidate.map(playerNameCacheTag)
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
