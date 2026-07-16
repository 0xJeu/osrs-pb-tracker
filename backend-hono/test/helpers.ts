import { db } from '../src/db/client.js';
import { players, personalBests, playerNameHistory, feedback } from '../src/db/schema.js';

export async function truncateAll() {
  await db.delete(personalBests);
  await db.delete(playerNameHistory);
  await db.delete(players);
  await db.delete(feedback);
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

export async function insertManyTestPlayersWithPbs(
  rows: Array<{ boss: string; timeSeconds: number; displayName: string; accountHash: string }>
) {
  const insertedPlayers = await db
    .insert(players)
    .values(rows.map((row) => ({
      accountHash: row.accountHash,
      displayName: row.displayName,
      displayNameLower: row.displayName.toLowerCase(),
      installSecretHash: 'test-secret-hash',
      updatedAt: new Date(),
    })))
    .returning({ id: players.id, accountHash: players.accountHash });

  const playerIdByHash = new Map(insertedPlayers.map((player) => [player.accountHash, player.id]));
  await db.insert(personalBests).values(rows.map((row) => ({
    playerId: playerIdByHash.get(row.accountHash)!,
    boss: row.boss,
    timeSeconds: row.timeSeconds,
    updatedAt: new Date(),
  })));
}
