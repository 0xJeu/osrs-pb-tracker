import { db } from '../src/db/client';
import { players, personalBests } from '../src/db/schema';

export async function truncateAll() {
  await db.delete(personalBests);
  await db.delete(players);
}

let counter = 0;

export async function insertTestPlayerWithPb(opts: {
  boss: string;
  timeSeconds: number;
  displayName?: string;
  accountHash?: string;
  updatedAt?: Date;
}) {
  counter += 1;
  const displayName = opts.displayName ?? `TestPlayer${counter}`;
  const [player] = await db
    .insert(players)
    .values({
      accountHash: opts.accountHash ?? `test-hash-${counter}`,
      displayName,
      displayNameLower: displayName.toLowerCase(),
      installSecretHash: 'test-secret-hash',
      updatedAt: opts.updatedAt ?? new Date(),
    })
    .returning();

  await db.insert(personalBests).values({
    playerId: player.id,
    boss: opts.boss,
    timeSeconds: opts.timeSeconds,
    updatedAt: new Date(),
  });

  return player;
}
