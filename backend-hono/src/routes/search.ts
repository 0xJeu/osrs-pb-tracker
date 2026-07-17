import { asc, eq, like, or } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../db/client.js';
import { personalBests, playerNameHistory, players } from '../db/schema.js';
import { bossSearchAliasTarget } from '../lib/bossAliases.js';

const search = new Hono();

search.get('/', async (c) => {
  const q = (c.req.query('q') ?? '').toLowerCase().trim();
  if (!q) {
    return c.json([]);
  }

  const rows = await db
    .select({ displayName: players.displayName })
    .from(players)
    .where(like(players.displayNameLower, `%${q}%`))
    .orderBy(players.displayNameLower)
    .limit(10);

  return c.json(rows.map((row) => row.displayName));
});

search.get('/all', async (c) => {
  const q = (c.req.query('q') ?? '').toLowerCase().trim();
  if (!q) return c.json([]);
  const bossAliasTarget = bossSearchAliasTarget(q);

  const [currentPlayers, historicPlayers, bosses] = await Promise.all([
    db
      .select({ value: players.displayName })
      .from(players)
      .where(like(players.displayNameLower, `%${q}%`))
      .orderBy(asc(players.displayNameLower))
      .limit(8),
    db
      .select({ value: players.displayName })
      .from(playerNameHistory)
      .innerJoin(players, eq(players.id, playerNameHistory.playerId))
      .where(like(playerNameHistory.displayNameLower, `%${q}%`))
      .orderBy(asc(players.displayNameLower))
      .limit(8),
    db
      .selectDistinct({ value: personalBests.boss })
      .from(personalBests)
      .where(bossAliasTarget
        ? or(like(personalBests.boss, `%${q}%`), like(personalBests.boss, `%${bossAliasTarget}%`))
        : like(personalBests.boss, `%${q}%`))
      .orderBy(asc(personalBests.boss))
      .limit(8),
  ]);

  const playerValues = Array.from(new Set([...currentPlayers, ...historicPlayers].map((row) => row.value))).slice(0, 8);
  return c.json([
    ...playerValues.map((value) => ({ type: 'player' as const, value })),
    ...bosses.map(({ value }) => ({ type: 'boss' as const, value })),
  ]);
});

export default search;
