import { desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../db/client';
import { personalBests, players } from '../db/schema';

const playersRoute = new Hono();

async function playerWithPbs(player: typeof players.$inferSelect) {
  const pbs = await db
    .select({
      boss: personalBests.boss,
      timeSeconds: personalBests.timeSeconds,
      updatedAt: personalBests.updatedAt,
    })
    .from(personalBests)
    .where(eq(personalBests.playerId, player.id))
    .orderBy(personalBests.boss);

  return {
    id: player.id,
    displayName: player.displayName,
    updatedAt: player.updatedAt,
    pbs,
  };
}

playersRoute.get('/by-id/:id', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) {
    return c.json({ error: 'Player not found' }, 404);
  }

  const rows = await db.select().from(players).where(eq(players.id, id)).limit(1);
  const player = rows[0];
  if (!player) {
    return c.json({ error: 'Player not found' }, 404);
  }

  return c.json(await playerWithPbs(player));
});

playersRoute.get('/:name', async (c) => {
  const nameLower = c.req.param('name').toLowerCase();
  const rows = await db
    .select()
    .from(players)
    .where(eq(players.displayNameLower, nameLower))
    .orderBy(desc(players.updatedAt));

  if (rows.length === 0) {
    return c.json({ error: 'Player not found' }, 404);
  }

  if (rows.length > 1) {
    return c.json({
      ambiguous: true,
      matches: rows.map((player) => ({
        id: player.id,
        displayName: player.displayName,
        updatedAt: player.updatedAt,
      })),
    });
  }

  return c.json(await playerWithPbs(rows[0]));
});

export default playersRoute;
