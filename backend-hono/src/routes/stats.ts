import { count } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../db/client.js';
import { personalBests, players } from '../db/schema.js';
import { cachePolicies, setSharedCache } from '../lib/cache.js';

const stats = new Hono();

stats.get('/', async (c) => {
  const [[playerTotal], [recordTotal]] = await Promise.all([
    db.select({ value: count(players.id) }).from(players),
    db.select({ value: count(personalBests.id) }).from(personalBests),
  ]);

  setSharedCache(c, cachePolicies.homeSummary);

  return c.json({
    trackedPlayers: Number(playerTotal?.value ?? 0),
    personalBestRecords: Number(recordTotal?.value ?? 0),
  });
});

export default stats;
