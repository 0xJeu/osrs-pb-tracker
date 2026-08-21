/**
 * One-off cleanup for personal_bests rows that fail the activity-specific
 * floors in src/lib/trackedBosses.ts (MIN_REASONABLE_SECONDS_BY_BOSS) -
 * i.e. times that are physically impossible for that boss but were synced
 * before a floor existed for it. Same trigger as
 * cleanup-untracked-bosses.ts, generalized to cover every current and future
 * floor instead of one specific boss/player.
 *
 * Immediate motivation: Theatre of Blood's top two "PBs" (45s and 73s) are a
 * full raid clear in under a minute, which cannot happen - see the 300s
 * floor added for 'theatre of blood'. Because sync only overwrites on a
 * faster time, these could never be displaced by a real run once they landed
 * at rank 1/2.
 *
 * Defaults to a dry run (lists what would be deleted). Pass --confirm to
 * actually delete - review the printed list first, since this is a straight
 * delete, not a restore of whatever real PB (if any) the row previously
 * overwrote.
 *
 * Usage:
 *   DATABASE_URL=... npx tsx scripts/cleanup-unreasonable-times.ts
 *   DATABASE_URL=... npx tsx scripts/cleanup-unreasonable-times.ts --confirm
 */
import { inArray } from 'drizzle-orm';
import { db } from '../src/db/client.js';
import { personalBests, players } from '../src/db/schema.js';
import { isReasonablePersonalBestTime } from '../src/lib/trackedBosses.js';
import {
  bossCacheTag,
  invalidateSharedCache,
  playerIdCacheTag,
  profileBossBucketCacheTag,
  profileBossExactCacheTag,
} from '../src/lib/cache.js';

async function main() {
  const confirm = process.argv.includes('--confirm');

  const rows = await db
    .select({
      id: personalBests.id,
      playerId: personalBests.playerId,
      boss: personalBests.boss,
      timeSeconds: personalBests.timeSeconds,
      updatedAt: personalBests.updatedAt,
    })
    .from(personalBests);

  const unreasonable = rows.filter((row) => !isReasonablePersonalBestTime(row.boss, row.timeSeconds));

  if (unreasonable.length === 0) {
    console.log('No unreasonable times found. Nothing to clean up.');
    return;
  }

  const playerIds = [...new Set(unreasonable.map((row) => row.playerId))];
  const playerRows = await db
    .select({ id: players.id, displayName: players.displayName })
    .from(players)
    .where(inArray(players.id, playerIds));
  const nameById = new Map(playerRows.map((p) => [p.id, p.displayName]));

  console.log(`Found ${unreasonable.length} unreasonable row(s):`);
  for (const row of unreasonable) {
    const name = nameById.get(row.playerId) ?? `player #${row.playerId}`;
    console.log(`  - ${name}: ${row.boss} = ${row.timeSeconds}s (updated ${row.updatedAt.toISOString()})`);
  }

  if (!confirm) {
    console.log('\nDry run only - pass --confirm to actually delete these rows.');
    return;
  }

  const deleted = await db
    .delete(personalBests)
    .where(
      inArray(
        personalBests.id,
        unreasonable.map((row) => row.id)
      )
    )
    .returning();
  console.log(`\nDeleted ${deleted.length} row(s).`);

  // The public leaderboard/profile responses this affects are cached for up
  // to 24h (see cachePolicies.publicData) - invalidate so the fix is visible
  // immediately instead of waiting out the TTL.
  const tags = new Set<string>();
  for (const row of deleted) {
    tags.add(bossCacheTag(row.boss));
    tags.add(profileBossExactCacheTag(row.boss));
    tags.add(profileBossBucketCacheTag(row.boss));
    tags.add(playerIdCacheTag(row.playerId));
  }
  await invalidateSharedCache([...tags]);
  console.log(`Invalidated ${tags.size} cache tag(s).`);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  }
);
