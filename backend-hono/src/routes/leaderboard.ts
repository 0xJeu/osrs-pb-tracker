import { asc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../db/client.js';
import { personalBests, players } from '../db/schema.js';

const leaderboard = new Hono();

// Hard ceiling on how many rows a `highlight` lookup can pull back, so a
// highlighted player sitting deep in a huge leaderboard can't force an
// unbounded response.
const MAX_HIGHLIGHT_ROWS = 500;

leaderboard.get('/:boss', async (c) => {
  const boss = c.req.param('boss').toLowerCase();
  const limitParam = Number(c.req.query('limit'));
  const limit = Math.min(Number.isFinite(limitParam) && limitParam > 0 ? limitParam : 25, 100);
  const highlight = c.req.query('highlight');

  const orderedQuery = db
    .select({
      displayName: players.displayName,
      timeSeconds: personalBests.timeSeconds,
      updatedAt: personalBests.updatedAt,
    })
    .from(personalBests)
    .innerJoin(players, eq(players.id, personalBests.playerId))
    .where(eq(personalBests.boss, boss))
    .orderBy(asc(personalBests.timeSeconds));

  if (highlight) {
    // Need every row up to the highlighted player's rank to know how far
    // down the list they are, so this can't be limited to `limit` up front
    // like the plain top-N case below. It's still bounded to
    // MAX_HIGHLIGHT_ROWS at the query level (not just when slicing the
    // response) since anything past that cap gets truncated anyway.
    const highlightLower = highlight.toLowerCase();
    const all = await orderedQuery.limit(MAX_HIGHLIGHT_ROWS);
    const rank = all.findIndex((row) => row.displayName.toLowerCase() === highlightLower);
    const rowsToReturn = rank === -1 ? limit : rank + 1;
    return c.json(all.slice(0, Math.max(rowsToReturn, limit)));
  }

  const rows = await orderedQuery.limit(limit);
  return c.json(rows);
});

export default leaderboard;
