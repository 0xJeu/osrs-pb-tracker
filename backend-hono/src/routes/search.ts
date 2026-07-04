import { Hono } from 'hono';
import { like } from 'drizzle-orm';
import { db } from '../db/client';
import { players } from '../db/schema';

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

  return c.json(rows.map((r) => r.displayName));
});

export default search;
