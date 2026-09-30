import { and, desc, eq, lt, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { Hono } from 'hono';
import { db } from '../db/client.js';
import { personalBests, playerNameHistory, players } from '../db/schema.js';
import {
  cachePolicies,
  fitsExactProfileTags,
  noteProfileBucketFallback,
  playerIdCacheTag,
  playerNameCacheTag,
  profileBossBucketCacheTag,
  profileBossExactCacheTag,
  setSharedCache,
} from '../lib/cache.js';
import {
  readPrimaryPublicSnapshot,
  schedulePublicSnapshotRepair,
} from '../lib/public-read-model/service.js';

const playersRoute = new Hono();

const otherPbs = alias(personalBests, 'other_pbs');

const publicPlayerColumns = {
  id: players.id,
  displayName: players.displayName,
  updatedAt: players.updatedAt,
};

type PublicPlayer = Pick<typeof players.$inferSelect, 'id' | 'displayName' | 'updatedAt'>;

// Rank on the boss's overall leaderboard: 1 + how many other players have a
// strictly faster time for the same boss. Built via the query builder (not a
// raw `sql` template referencing the alias directly) so drizzle actually
// emits the `AS other_pbs` aliasing in the generated SQL.
const rankSubquery = db
  .select({ rank: sql<number>`count(*) + 1` })
  .from(otherPbs)
  .where(and(eq(otherPbs.boss, personalBests.boss), lt(otherPbs.timeSeconds, personalBests.timeSeconds)));

async function playerWithPbs(player: PublicPlayer) {
  const pbs = await db
    .select({
      boss: personalBests.boss,
      timeSeconds: personalBests.timeSeconds,
      updatedAt: personalBests.updatedAt,
      rank: sql<number>`(${rankSubquery})`,
    })
    .from(personalBests)
    .where(eq(personalBests.playerId, player.id))
    .orderBy(personalBests.boss);

  return {
    id: player.id,
    displayName: player.displayName,
    updatedAt: player.updatedAt,
    pbs: pbs.map((pb) => ({ ...pb, rank: Number(pb.rank) })),
  };
}

// Below a shared per-response cap, tag each PB individually so a boss
// change only invalidates the profiles that actually depend on it. Above
// the cap, fall back to the coarser 32-bucket scheme (profileBossBucketCacheTag)
// so the response never exceeds Vercel's 128-tag limit - see fitsExactProfileTags
// and profileBossBucketCacheTag in ../lib/cache.js for the full rationale.
// sync.ts's invalidation path pushes BOTH the exact and bucket tag for every
// changed boss precisely so this fallback stays correct across a rolling
// deploy and for any profile currently using either scheme.
function profileCacheTags(payload: { id: number; pbs: Array<{ boss: string }> }) {
  const useExactTags = fitsExactProfileTags(payload.pbs.length);
  if (!useExactTags) {
    noteProfileBucketFallback();
  }
  const bossDependencyTags = useExactTags
    ? payload.pbs.map((pb) => profileBossExactCacheTag(pb.boss))
    : payload.pbs.map((pb) => profileBossBucketCacheTag(pb.boss));

  return [playerIdCacheTag(payload.id), ...bossDependencyTags];
}

playersRoute.get('/by-id/:id', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isSafeInteger(id) || id <= 0) {
    setSharedCache(c, cachePolicies.notFound);
    return c.json({ error: 'Player not found' }, 404);
  }

  const snapshot = await readPrimaryPublicSnapshot();
  const cachedProfile = snapshot?.profilesByPlayerId[String(id)];
  if (cachedProfile) {
    setSharedCache(c, cachePolicies.publicData, profileCacheTags(cachedProfile));
    return c.json(cachedProfile);
  }
  if (!snapshot) schedulePublicSnapshotRepair();

  const rows = await db.select(publicPlayerColumns).from(players).where(eq(players.id, id)).limit(1);
  const player = rows[0];
  if (!player) {
    setSharedCache(c, cachePolicies.notFound, [playerIdCacheTag(id)]);
    return c.json({ error: 'Player not found' }, 404);
  }

  // A database hit for an ID absent from an otherwise valid snapshot proves
  // the snapshot is stale; rebuild it. Genuine unknown IDs do not rebuild.
  if (snapshot && !cachedProfile) schedulePublicSnapshotRepair();

  const payload = await playerWithPbs(player);
  setSharedCache(c, cachePolicies.publicData, profileCacheTags(payload));
  return c.json(payload);
});

playersRoute.get('/:name', async (c) => {
  const nameLower = c.req.param('name').trim().toLowerCase();
  const snapshot = await readPrimaryPublicSnapshot();
  const snapshotIds = snapshot?.playerIdsByLookupName[nameLower];
  let snapshotHasBrokenReferences = false;
  if (snapshotIds && snapshotIds.length > 0) {
    const matches = snapshotIds
      .map((id) => snapshot.profilesByPlayerId[String(id)])
      .filter((profile) => profile !== undefined);
    if (matches.length === snapshotIds.length) {
      if (matches.length > 1) {
        setSharedCache(c, cachePolicies.publicData, [
          playerNameCacheTag(nameLower),
          ...matches.map((player) => playerIdCacheTag(player.id)),
        ]);
        return c.json({
          ambiguous: true,
          matches: matches.map((player) => ({
            id: player.id,
            displayName: player.displayName,
            updatedAt: player.updatedAt,
          })),
        });
      }
      const payload = matches[0];
      setSharedCache(c, cachePolicies.publicData, [
        playerNameCacheTag(nameLower),
        ...profileCacheTags(payload),
      ]);
      return c.json(payload);
    }
    snapshotHasBrokenReferences = true;
  }
  // Snapshot misses deliberately fall back to Neon. This prevents a snapshot
  // that predates a newly-created player from producing a false 404.
  if (!snapshot || snapshotHasBrokenReferences) schedulePublicSnapshotRepair();

  const currentRows = await db
    .select(publicPlayerColumns)
    .from(players)
    .where(eq(players.displayNameLower, nameLower))
    .orderBy(desc(players.updatedAt));

  const historicRows = await db
    .select(publicPlayerColumns)
    .from(playerNameHistory)
    .innerJoin(players, eq(players.id, playerNameHistory.playerId))
    .where(eq(playerNameHistory.displayNameLower, nameLower))
    .orderBy(desc(players.updatedAt));

  const rows = Array.from(
    new Map([...currentRows, ...historicRows].map((player) => [player.id, player])).values()
  );

  if (rows.length === 0) {
    setSharedCache(c, cachePolicies.notFound, [playerNameCacheTag(nameLower)]);
    return c.json({ error: 'Player not found' }, 404);
  }

  // A real database match missing from a valid snapshot means publication is
  // behind. Legitimate unknown-name traffic must not rebuild the snapshot.
  if (snapshot && !snapshotIds) schedulePublicSnapshotRepair();

  if (rows.length > 1) {
    setSharedCache(c, cachePolicies.publicData, [
      playerNameCacheTag(nameLower),
      ...rows.map((player) => playerIdCacheTag(player.id)),
    ]);
    return c.json({
      ambiguous: true,
      matches: rows.map((player) => ({
        id: player.id,
        displayName: player.displayName,
        updatedAt: player.updatedAt,
      })),
    });
  }

  const payload = await playerWithPbs(rows[0]);
  setSharedCache(c, cachePolicies.publicData, [
    playerNameCacheTag(nameLower),
    ...profileCacheTags(payload),
  ]);
  return c.json(payload);
});

export default playersRoute;
