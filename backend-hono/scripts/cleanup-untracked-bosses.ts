/**
 * One-off cleanup for personal_bests rows synced before the sync route
 * started rejecting bosses with no official Jagex personal best (see
 * src/lib/trackedBosses.ts). Run against a real DATABASE_URL.
 *
 * Defaults to a dry run (lists what would be deleted). Pass --confirm to
 * actually delete - review the printed list first.
 *
 * Usage:
 *   DATABASE_URL=... npx tsx scripts/cleanup-untracked-bosses.ts
 *   DATABASE_URL=... npx tsx scripts/cleanup-untracked-bosses.ts --confirm
 */
import { inArray } from 'drizzle-orm';
import { db } from '../src/db/client.js';
import { personalBests } from '../src/db/schema.js';
import { isTrackedBoss } from '../src/lib/trackedBosses.js';

async function main() {
  const confirm = process.argv.includes('--confirm');

  const rows = await db.select({ boss: personalBests.boss }).from(personalBests);
  const untrackedBosses = [...new Set(rows.map((r) => r.boss).filter((boss) => !isTrackedBoss(boss)))];

  if (untrackedBosses.length === 0) {
    console.log('No untracked bosses found. Nothing to clean up.');
    return;
  }

  console.log(`Found ${untrackedBosses.length} untracked boss key(s) in personal_bests:`);
  for (const boss of untrackedBosses) {
    console.log(`  - ${boss}`);
  }

  if (!confirm) {
    console.log('\nDry run only - pass --confirm to actually delete these rows.');
    return;
  }

  const deleted = await db
    .delete(personalBests)
    .where(inArray(personalBests.boss, untrackedBosses))
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
