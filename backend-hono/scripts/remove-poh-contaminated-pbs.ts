/**
 * One-off cleanup for a specific, confirmed incident: on 2026-07-12 around
 * 00:07:5X UTC, the "Blitzen" account had another player's ("Dad") Adventure
 * Log Counters data synced onto it after visiting their POH and reading
 * their Adventure Log, prior to the ownership fix in
 * https://github.com/0xJeu/pb-tracker-sync/pull/2. Confirmed by George
 * (Blitzen's owner) that the raid team-size/mode-labeled entries below are
 * not his - the other bosses synced in the same burst (araxxor, grotesque
 * guardians, nex, the hueycoatl, tzhaar fight cave, zulrah) were separately
 * confirmed as legitimately his and are NOT touched by this script.
 *
 * Defaults to a dry run (lists the exact rows that would be deleted). Pass
 * --confirm to actually delete - review the printed list first, since the
 * upsert logic that caused this only overwrites on a faster time, meaning
 * any real prior PB Blitzen had for these same boss keys was already
 * silently replaced and is not recoverable by this script - it only removes
 * the contaminated row, it can't restore what was overwritten.
 *
 * Usage:
 *   DATABASE_URL=... npx tsx scripts/remove-poh-contaminated-pbs.ts
 *   DATABASE_URL=... npx tsx scripts/remove-poh-contaminated-pbs.ts --confirm
 */
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../src/db/client.js';
import { personalBests, players } from '../src/db/schema.js';

const AFFECTED_DISPLAY_NAME_LOWER = 'blitzen';

const CONTAMINATED_BOSS_KEYS = [
  'chambers of xeric - fastest overall (2 players)',
  'chambers of xeric - fastest overall (4 players)',
  'chambers of xeric - fastest overall (5 players)',
  'chambers of xeric - fastest overall (6 players)',
  'chambers of xeric - fastest overall (7 players)',
  'chambers of xeric - fastest overall (8 players)',
  'the nightmare - fastest overall (4 players)',
  'the nightmare - fastest overall (5 players)',
  'the nightmare - fastest overall (6+ players)',
  'theatre of blood - entry - fastest overall (4 player entry mode)',
  'theatre of blood - entry - fastest overall (5 player entry mode)',
  'theatre of blood - entry - fastest room (4 player entry mode)',
  'theatre of blood - entry - fastest room (5 player entry mode)',
  'tombs of amascut - expert - fastest overall (2 player)',
  'tombs of amascut - expert - fastest overall (3 player)',
  'tombs of amascut - expert - fastest overall (4 player)',
  'tombs of amascut - expert - fastest overall (5 player)',
  'tombs of amascut - expert - fastest overall (6 player)',
  'tombs of amascut - expert - fastest overall (7 player)',
  'tombs of amascut - expert - fastest overall (8 player)',
  'tombs of amascut - expert - fastest room (2 player)',
  'tombs of amascut - expert - fastest room (3 player)',
  'tombs of amascut - expert - fastest room (4 player)',
  'tombs of amascut - expert - fastest room (5 player)',
  'tombs of amascut - expert - fastest room (6 player)',
  'tombs of amascut - expert - fastest room (7 player)',
  'tombs of amascut - expert - fastest room (8 player)',
  'tombs of amascut - fastest overall (2 player)',
  'tombs of amascut - fastest overall (3 player)',
  'tombs of amascut - fastest overall (4 player)',
  'tombs of amascut - fastest overall (5 player)',
  'tombs of amascut - fastest overall (6 player)',
  'tombs of amascut - fastest overall (7 player)',
  'tombs of amascut - fastest overall (8 player)',
  'tombs of amascut - fastest overall (solo)',
  'tombs of amascut - fastest room (2 player)',
  'tombs of amascut - fastest room (3 player)',
  'tombs of amascut - fastest room (4 player)',
  'tombs of amascut - fastest room (5 player)',
  'tombs of amascut - fastest room (6 player)',
  'tombs of amascut - fastest room (7 player)',
  'tombs of amascut - fastest room (8 player)',
  'tombs of amascut - fastest room (solo)',
];

async function main() {
  const confirm = process.argv.includes('--confirm');

  const playerRows = await db
    .select()
    .from(players)
    .where(eq(players.displayNameLower, AFFECTED_DISPLAY_NAME_LOWER));

  if (playerRows.length !== 1) {
    console.error(`Expected exactly one player matching "${AFFECTED_DISPLAY_NAME_LOWER}", found ${playerRows.length}. Aborting.`);
    process.exit(1);
  }

  const player = playerRows[0];

  const rows = await db
    .select()
    .from(personalBests)
    .where(and(eq(personalBests.playerId, player.id), inArray(personalBests.boss, CONTAMINATED_BOSS_KEYS)));

  if (rows.length === 0) {
    console.log(`No matching contaminated rows found for ${player.displayName}. Nothing to clean up.`);
    return;
  }

  console.log(`Found ${rows.length} contaminated row(s) for ${player.displayName}:`);
  for (const row of rows) {
    console.log(`  - ${row.boss} = ${row.timeSeconds}s (updated ${row.updatedAt.toISOString()})`);
  }

  if (!confirm) {
    console.log('\nDry run only - pass --confirm to actually delete these rows.');
    return;
  }

  const deleted = await db
    .delete(personalBests)
    .where(and(eq(personalBests.playerId, player.id), inArray(personalBests.boss, CONTAMINATED_BOSS_KEYS)))
    .returning();
  console.log(`\nDeleted ${deleted.length} row(s).`);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  }
);
