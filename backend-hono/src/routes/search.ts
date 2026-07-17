import { like } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../db/client.js';
import { players } from '../db/schema.js';
import { cachePolicies, cacheTags, setSharedCache } from '../lib/cache.js';

const search = new Hono();

search.get('/', async (c) => {
  const q = (c.req.query('q') ?? '').toLowerCase().trim();
  if (q.length < 2) {
    setSharedCache(c, cachePolicies.publicData, [cacheTags.search]);
    return c.json([]);
  }

  const rows = await db
    .select({ displayName: players.displayName })
    .from(players)
    .where(like(players.displayNameLower, `%${q}%`))
    .orderBy(players.displayNameLower)
    .limit(10);

  setSharedCache(c, cachePolicies.publicData, [cacheTags.search]);
  return c.json(rows.map((row) => row.displayName));
});

export default search;
