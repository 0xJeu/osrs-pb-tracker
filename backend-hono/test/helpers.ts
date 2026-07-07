import { eq } from 'drizzle-orm';
import { db } from '../src/db/client.js';
import { admins, feedback, personalBests, players } from '../src/db/schema.js';
import { hashPassword } from '../src/lib/adminPassword.js';

export async function truncateAll() {
  await db.delete(personalBests);
  await db.delete(players);
  await db.delete(feedback);
  await db.delete(admins);
}

let counter = 0;

export async function insertTestPlayerWithPb(opts: {
  boss: string;
  timeSeconds: number;
  displayName?: string;
  accountHash?: string;
  updatedAt?: Date;
  createdAt?: Date;
  lastSyncedAt?: Date;
}) {
  counter += 1;
  const displayName = opts.displayName ?? `TestPlayer${counter}`;
  const now = new Date();
  const [player] = await db
    .insert(players)
    .values({
      accountHash: opts.accountHash ?? `test-hash-${counter}`,
      displayName,
      displayNameLower: displayName.toLowerCase(),
      installSecretHash: 'test-secret-hash',
      updatedAt: opts.updatedAt ?? now,
      createdAt: opts.createdAt ?? now,
      lastSyncedAt: opts.lastSyncedAt ?? now,
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

export async function insertTestAdmin(username: string, password: string) {
  const { hash, salt } = hashPassword(password);
  await db.insert(admins).values({ username, passwordHash: hash, passwordSalt: salt });
}

export async function getPlayerByAccountHash(accountHash: string) {
  const rows = await db.select().from(players).where(eq(players.accountHash, accountHash)).limit(1);
  return rows[0];
}
