import { count, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../db/client.js';
import { personalBests, players } from '../db/schema.js';
import { cachePolicies, setSharedCache } from '../lib/cache.js';

const recentSyncs = new Hono();

function parseLimit(value: string | undefined) {
  if (!value) return 10;

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 10;

  return Math.min(Math.floor(parsed), 25);
}

recentSyncs.get('/', async (c) => {
  const limit = parseLimit(c.req.query('limit'));
  const rows = await db
    .select({
      id: players.id,
      displayName: players.displayName,
      updatedAt: players.updatedAt,
      pbCount: count(personalBests.id),
    })
    .from(players)
    .leftJoin(personalBests, eq(personalBests.playerId, players.id))
    .groupBy(players.id, players.displayName, players.updatedAt)
    .orderBy(desc(players.updatedAt))
    .limit(limit);

  setSharedCache(c, cachePolicies.homeSummary);
  return c.json(
    rows.map((row) => ({
      id: row.id,
      displayName: row.displayName,
      updatedAt: row.updatedAt.toISOString(),
      pbCount: Number(row.pbCount),
    }))
  );
});

export default recentSyncs;
