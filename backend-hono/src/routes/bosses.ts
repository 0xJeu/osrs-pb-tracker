import { Hono } from 'hono';
import { db } from '../db/client';
import { personalBests } from '../db/schema';

const bosses = new Hono();

bosses.get('/', async (c) => {
  const rows = await db
    .selectDistinct({ boss: personalBests.boss })
    .from(personalBests)
    .orderBy(personalBests.boss);

  return c.json(rows.map((row) => row.boss));
});

export default bosses;
