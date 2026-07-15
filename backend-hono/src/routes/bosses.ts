import { Hono } from 'hono';
import { db } from '../db/client.js';
import { personalBests } from '../db/schema.js';
import { cachePolicies, cacheTags, setSharedCache } from '../lib/cache.js';
import { redirectToCanonicalGet } from '../lib/canonicalRequest.js';

const bosses = new Hono();

bosses.get('/', async (c) => {
  const redirect = redirectToCanonicalGet(c, '/api/bosses');
  if (redirect) return redirect;

  const rows = await db
    .selectDistinct({ boss: personalBests.boss })
    .from(personalBests)
    .orderBy(personalBests.boss);

  setSharedCache(c, cachePolicies.publicData, [cacheTags.bossList]);
  return c.json(rows.map((row) => row.boss));
});

export default bosses;
