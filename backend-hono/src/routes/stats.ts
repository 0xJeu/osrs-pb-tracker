import { count } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../db/client.js';
import { personalBests, players } from '../db/schema.js';
import { cachePolicies, cacheTags, setSharedCache } from '../lib/cache.js';
import { redirectToCanonicalGet } from '../lib/canonicalRequest.js';

const stats = new Hono();

stats.get('/', async (c) => {
  const redirect = redirectToCanonicalGet(c, '/api/stats');
  if (redirect) return redirect;

  const [[playerTotal], [recordTotal]] = await Promise.all([
    db.select({ value: count(players.id) }).from(players),
    db.select({ value: count(personalBests.id) }).from(personalBests),
  ]);

  setSharedCache(c, cachePolicies.publicData, [cacheTags.stats]);

  return c.json({
    trackedPlayers: Number(playerTotal?.value ?? 0),
    personalBestRecords: Number(recordTotal?.value ?? 0),
  });
});

export default stats;
