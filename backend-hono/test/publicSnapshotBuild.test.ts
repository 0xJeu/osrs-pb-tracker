import { expect, it } from 'vitest';
import { db } from '../src/db/client.js';
import { personalBests, playerNameHistory, publicReadModelState } from '../src/db/schema.js';
import { buildPublicSnapshot } from '../src/lib/public-read-model/build.js';
import { insertTestPlayerWithPb } from './helpers.js';

it('builds a complete rank- and historical-name-aware public snapshot', async () => {
  const [stateBefore] = await db.select().from(publicReadModelState);
  const fast = await insertTestPlayerWithPb({
    boss: 'zulrah',
    timeSeconds: 70,
    displayName: 'Fast',
    accountHash: 'snapshot-fast',
  });
  const slow = await insertTestPlayerWithPb({
    boss: 'zulrah',
    timeSeconds: 90,
    displayName: 'Slow',
    accountHash: 'snapshot-slow',
  });
  await db.insert(personalBests).values({
    playerId: fast.id,
    boss: 'vorkath',
    timeSeconds: 60,
    updatedAt: new Date(),
  });
  await db.insert(playerNameHistory).values({
    playerId: fast.id,
    displayName: 'Old Fast',
    displayNameLower: 'old fast',
    createdAt: new Date(),
  });

  const snapshot = await buildPublicSnapshot();
  expect(BigInt(snapshot.revision)).toBeGreaterThan(stateBefore.revision);
  expect(snapshot.sourceCounts).toEqual({
    players: 2,
    nameHistory: 1,
    personalBests: 3,
    bosses: 2,
  });
  expect(snapshot.bosses).toEqual(['vorkath', 'zulrah']);
  expect(snapshot.playerIdsByLookupName['old fast']).toEqual([fast.id]);
  expect(snapshot.profilesByPlayerId[String(fast.id)].pbs).toEqual([
    expect.objectContaining({ boss: 'vorkath', rank: 1 }),
    expect.objectContaining({ boss: 'zulrah', rank: 1 }),
  ]);
  expect(snapshot.profilesByPlayerId[String(slow.id)].pbs).toEqual([
    expect.objectContaining({ boss: 'zulrah', rank: 2 }),
  ]);
});
