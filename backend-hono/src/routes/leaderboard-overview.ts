import { asc, eq, inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../db/client.js';
import { personalBests, players } from '../db/schema.js';
import { CURATED_OVERVIEW_BOSSES } from '../lib/curatedOverviewBosses.js';
import { bossCacheTag, cachePolicies, setSharedCache } from '../lib/cache.js';

const leaderboardOverview = new Hono();

leaderboardOverview.get('/', async (c) => {
  // DISTINCT ON (boss) with this ordering gives exactly one row per boss:
  // the fastest time, tie-broken by display name so repeated requests with
  // an identical tie are always byte-identical (cache-friendly, testable).
  const rows = await db
    .selectDistinctOn([personalBests.boss], {
      boss: personalBests.boss,
      displayName: players.displayName,
      timeSeconds: personalBests.timeSeconds,
      updatedAt: personalBests.updatedAt,
    })
    .from(personalBests)
    .innerJoin(players, eq(players.id, personalBests.playerId))
    .where(inArray(personalBests.boss, [...CURATED_OVERVIEW_BOSSES]))
    .orderBy(asc(personalBests.boss), asc(personalBests.timeSeconds), asc(players.displayNameLower));

  const byBoss = new Map(rows.map((row) => [row.boss, row]));
  const overview = CURATED_OVERVIEW_BOSSES.map((boss) => {
    const row = byBoss.get(boss);
    return {
      boss,
      leader: row
        ? { displayName: row.displayName, timeSeconds: row.timeSeconds, updatedAt: row.updatedAt }
        : null,
    };
  });

  setSharedCache(
    c,
    cachePolicies.publicData,
    CURATED_OVERVIEW_BOSSES.map((boss) => bossCacheTag(boss))
  );
  return c.json(overview);
});

export default leaderboardOverview;
