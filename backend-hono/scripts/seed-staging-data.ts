import { config } from 'dotenv';

config({ path: '.env.staging' });

const confirm = process.argv.includes('--confirm');
if (!confirm) {
  throw new Error('Seeding is write-enabled. Re-run with --confirm after verifying .env.staging.');
}

const { eq, and, inArray } = await import('drizzle-orm');
const { assertDatabaseTarget } = await import('../src/db/targetGuard.js');
await assertDatabaseTarget('seeded-staging');

const { db } = await import('../src/db/client.js');
const { feedback, personalBests, playerNameHistory, players, syncAttempts } = await import(
  '../src/db/schema.js'
);
const { hashSecret } = await import('../src/lib/secret.js');

const now = new Date();

const fixtures = [
  {
    accountHash: 'staging-nightmare-qa',
    displayName: 'Nightmare QA',
    auditOutcome: 'accepted',
    oldNames: ['Nightmare QA Old'],
    pbs: {
      "phosani's nightmare": 283.8,
      'alchemical hydra': 76.2,
      zulrah: 54.6,
      vorkath: 61.8,
    },
  },
  {
    accountHash: 'staging-speed-chaser',
    displayName: 'Speed Chaser',
    auditOutcome: 'install_secret_mismatch',
    oldNames: [],
    pbs: { "phosani's nightmare": 276.4, zulrah: 49.8, vorkath: 57.3 },
  },
  {
    accountHash: 'staging-raid-sample',
    displayName: 'Raid Sample',
    auditOutcome: 'accepted',
    oldNames: [],
    pbs: {
      'tombs of amascut - fastest overall (solo)': 1524.2,
      'tombs of amascut - expert - fastest overall (solo)': 1812.7,
      'chambers of xeric - fastest overall (3 players)': 1248.9,
      'theatre of blood - fastest overall (4 players)': 1121.5,
    },
  },
  {
    accountHash: 'staging-tie-a',
    displayName: 'Tie Tester A',
    auditOutcome: 'accepted',
    oldNames: [],
    pbs: { vorkath: 58.2, zulrah: 52.1 },
  },
  {
    accountHash: 'staging-tie-b',
    displayName: 'Tie Tester B',
    auditOutcome: 'rate_limited',
    oldNames: [],
    pbs: { vorkath: 58.2, zulrah: 53.4 },
  },
  {
    accountHash: 'staging-awakened-sample',
    displayName: 'Awakened QA',
    auditOutcome: 'accepted',
    oldNames: [],
    pbs: { 'duke sucellus': 96.4, leviathan: 110.7, vardorvis: 78.9, whisperer: 143.1 },
  },
  {
    accountHash: 'staging-rename-sample',
    displayName: 'Renamed Sample',
    auditOutcome: 'accepted',
    oldNames: ['Original Sample'],
    pbs: { 'corrupted gauntlet': 412.6, gauntlet: 337.4, 'phantom muspah': 128.3 },
  },
  {
    accountHash: 'staging-endgame-sample',
    displayName: 'Endgame Sample',
    auditOutcome: 'accepted',
    oldNames: [],
    pbs: { inferno: 4021.7, 'fortis colosseum': 1895.4, 'tzhaar fight cave': 2142.8 },
  },
] as const;

let pbCount = 0;
let historyCount = 0;

for (const fixture of fixtures) {
  const [player] = await db
    .insert(players)
    .values({
      accountHash: fixture.accountHash,
      displayName: fixture.displayName,
      displayNameLower: fixture.displayName.toLowerCase(),
      installSecretHash: hashSecret(`public-staging-fixture:${fixture.accountHash}`),
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: players.accountHash,
      set: {
        displayName: fixture.displayName,
        displayNameLower: fixture.displayName.toLowerCase(),
        installSecretHash: hashSecret(`public-staging-fixture:${fixture.accountHash}`),
        updatedAt: now,
      },
    })
    .returning({ id: players.id });

  for (const [boss, timeSeconds] of Object.entries(fixture.pbs)) {
    await db
      .insert(personalBests)
      .values({ playerId: player.id, boss, timeSeconds, updatedAt: now })
      .onConflictDoUpdate({
        target: [personalBests.playerId, personalBests.boss],
        set: { timeSeconds, updatedAt: now },
      });
    pbCount += 1;
  }

  for (const oldName of fixture.oldNames) {
    await db
      .insert(playerNameHistory)
      .values({
        playerId: player.id,
        displayName: oldName,
        displayNameLower: oldName.toLowerCase(),
        createdAt: now,
      })
      .onConflictDoNothing();
    historyCount += 1;
  }

  const [existingAttempt] = await db
    .select({ id: syncAttempts.id })
    .from(syncAttempts)
    .where(
      and(
        eq(syncAttempts.playerId, player.id),
        inArray(syncAttempts.outcome, [fixture.auditOutcome, 'seeded_fixture'])
      )
    )
    .limit(1);

  const isAccepted = fixture.auditOutcome === 'accepted';
  const attemptValues = {
    outcome: fixture.auditOutcome,
    httpStatus:
      fixture.auditOutcome === 'accepted'
        ? 200
        : fixture.auditOutcome === 'install_secret_mismatch'
          ? 409
          : 429,
    receivedCount: Object.keys(fixture.pbs).length,
    eligibleCount: isAccepted ? Object.keys(fixture.pbs).length : null,
    updatedCount: isAccepted ? Object.keys(fixture.pbs).length : null,
    createdAt: now,
  };

  if (existingAttempt) {
    await db.update(syncAttempts).set(attemptValues).where(eq(syncAttempts.id, existingAttempt.id));
  } else {
    await db.insert(syncAttempts).values({ playerId: player.id, ...attemptValues });
  }
}

const existingFeedback = await db
  .select({ id: feedback.id })
  .from(feedback)
  .where(eq(feedback.context, 'seeded-staging'))
  .limit(1);

if (existingFeedback.length === 0) {
  await db.insert(feedback).values({
    message: 'Synthetic staging feedback fixture. Safe to replace.',
    context: 'seeded-staging',
    createdAt: now,
  });
}

console.log(
  `Seeded ${fixtures.length} synthetic players, ${pbCount} PBs, and ${historyCount} name-history rows.`
);
