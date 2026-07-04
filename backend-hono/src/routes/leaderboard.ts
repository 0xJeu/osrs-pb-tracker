import { asc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../db/client';
import { personalBests, players } from '../db/schema';

const leaderboard = new Hono();

leaderboard.get('/:boss', async (c) => {
  const boss = c.req.param('boss').toLowerCase();
  const limitParam = Number(c.req.query('limit'));
  const limit = Math.min(Number.isFinite(limitParam) && limitParam > 0 ? limitParam : 25, 100);

  const rows = await db
    .select({
      displayName: players.displayName,
      timeSeconds: personalBests.timeSeconds,
      updatedAt: personalBests.updatedAt,
    })
    .from(personalBests)
    .innerJoin(players, eq(players.id, personalBests.playerId))
    .where(eq(personalBests.boss, boss))
    .orderBy(asc(personalBests.timeSeconds))
    .limit(limit);

  return c.json(rows);
});

export default leaderboard;
