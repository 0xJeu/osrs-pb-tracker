import { like } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../db/client.js';
import { players } from '../db/schema.js';
import { cachePolicies, cacheTags, setSharedCache } from '../lib/cache.js';
import { redirectToCanonicalGet } from '../lib/canonicalRequest.js';

const search = new Hono();

search.get('/', async (c) => {
  const q = (c.req.query('q') ?? '').toLowerCase().trim();
  const canonicalParams = new URLSearchParams();
  if (q) canonicalParams.set('q', q);
  const redirect = redirectToCanonicalGet(c, '/api/search', canonicalParams);
  if (redirect) return redirect;

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
