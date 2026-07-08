import { count } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../db/client.js';
import { personalBests, players } from '../db/schema.js';

const stats = new Hono();

stats.get('/', async (c) => {
  const [playerTotal] = await db.select({ value: count(players.id) }).from(players);
  const [recordTotal] = await db.select({ value: count(personalBests.id) }).from(personalBests);

  return c.json({
    trackedPlayers: Number(playerTotal?.value ?? 0),
    personalBestRecords: Number(recordTotal?.value ?? 0),
  });
});

export default stats;
