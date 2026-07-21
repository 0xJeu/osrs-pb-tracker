import { config } from 'dotenv';

config({ path: '.env.staging' });

const { and, eq, inArray, sql } = await import('drizzle-orm');
const { assertDatabaseTarget } = await import('../src/db/targetGuard.js');
await assertDatabaseTarget('seeded-staging');

const { db } = await import('../src/db/client.js');
const { personalBests, playerNameHistory, players, syncAttempts } = await import(
  '../src/db/schema.js'
);

const fixtureHashes = [
  'staging-nightmare-qa',
  'staging-speed-chaser',
  'staging-raid-sample',
  'staging-tie-a',
  'staging-tie-b',
  'staging-awakened-sample',
  'staging-rename-sample',
  'staging-endgame-sample',
];

const [counts] = await db
  .select({
    players: sql<number>`count(distinct ${players.id})`,
    personalBests: sql<number>`count(${personalBests.id})`,
  })
  .from(players)
  .leftJoin(personalBests, eq(personalBests.playerId, players.id))
  .where(inArray(players.accountHash, fixtureHashes));

const pnm = await db
  .select({ displayName: players.displayName, timeSeconds: personalBests.timeSeconds })
  .from(players)
  .innerJoin(personalBests, eq(personalBests.playerId, players.id))
  .where(
    and(
      eq(players.accountHash, 'staging-nightmare-qa'),
      eq(personalBests.boss, "phosani's nightmare")
    )
  );

const history = await db
  .select({ id: playerNameHistory.id })
  .from(playerNameHistory)
  .innerJoin(players, eq(players.id, playerNameHistory.playerId))
  .where(eq(players.accountHash, 'staging-rename-sample'));

const attempts = await db
  .select({ id: syncAttempts.id })
  .from(syncAttempts)
  .innerJoin(players, eq(players.id, syncAttempts.playerId))
  .where(inArray(players.accountHash, fixtureHashes));

if (
  Number(counts?.players) !== fixtureHashes.length ||
  Number(counts?.personalBests) < 20 ||
  pnm[0]?.timeSeconds !== 283.8 ||
  history.length < 1 ||
  attempts.length < fixtureHashes.length
) {
  throw new Error('Seeded staging smoke check failed');
}

console.log(
  `Staging smoke passed: ${counts.players} fixture players, ${counts.personalBests} PBs, ` +
    `${history.length} rename row(s), ${attempts.length} sync-attempt row(s); PNM fixture is 283.8s.`
);
