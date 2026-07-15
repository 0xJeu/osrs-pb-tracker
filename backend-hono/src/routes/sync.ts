import { eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../db/client.js';
import { personalBests, players } from '../db/schema.js';
import {
  bossCacheTag,
  cacheTags,
  invalidateSharedCache,
  playerIdCacheTag,
  playerNameCacheTag,
  profileBossBucketCacheTag,
} from '../lib/cache.js';
import { hashSecret, isRateLimited } from '../lib/secret.js';
import { isRedundantDuplicateKey, isTrackedBoss } from '../lib/trackedBosses.js';

const sync = new Hono();

interface SyncBody {
  accountHash?: unknown;
  displayName?: unknown;
  installSecret?: unknown;
  pbs?: unknown;
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

  if (isRateLimited(accountHash)) {
    return c.json({ error: 'Too many sync requests for this account, slow down.' }, 429);
  }

  const secretHash = hashSecret(installSecret);
  const { playerId, authorized, metadataChanged, created, namesToInvalidate } = await upsertPlayer(
    accountHash,
    displayName,
    secretHash
  );

  if (!authorized) {
    return c.json(
      {
        error:
          'This account is already synced from a different install. If this is really you, the original install secret is required.',
      },
      409
    );
  }

  const entries = Object.entries(pbs as Record<string, unknown>);
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

  const changedBosses = await upsertPbs(playerId, pbsByBoss);
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
      cacheTags.stats,
      playerIdCacheTag(playerId),
      ...changedBosses.flatMap((boss) => [bossCacheTag(boss), profileBossBucketCacheTag(boss)])
    );
  }

  await invalidateSharedCache(invalidationTags);

  return c.json({ ok: true, playerId, received: entries.length, updated: changedBosses.length });
});

export default sync;
