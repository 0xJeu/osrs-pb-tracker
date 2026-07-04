import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../db/client.js';
import { personalBests, players } from '../db/schema.js';
import { hashSecret, isRateLimited } from '../lib/secret.js';

const sync = new Hono();

interface SyncBody {
  accountHash?: unknown;
  displayName?: unknown;
  installSecret?: unknown;
  pbs?: unknown;
}

async function upsertPlayer(accountHash: string, displayName: string, secretHash: string) {
  const displayNameLower = displayName.toLowerCase();
  const existingRows = await db.select().from(players).where(eq(players.accountHash, accountHash)).limit(1);
  const existing = existingRows[0];

  if (!existing) {
    const [inserted] = await db
      .insert(players)
      .values({
        accountHash,
        displayName,
        displayNameLower,
        installSecretHash: secretHash,
        updatedAt: new Date(),
      })
      .returning();
    return { playerId: inserted.id, authorized: true };
  }

  if (!existing.installSecretHash) {
    await db.update(players).set({ installSecretHash: secretHash }).where(eq(players.id, existing.id));
  } else if (existing.installSecretHash !== secretHash) {
    return { playerId: existing.id, authorized: false };
  }

  if (existing.displayName !== displayName) {
    await db
      .update(players)
      .set({ displayName, displayNameLower, updatedAt: new Date() })
      .where(eq(players.id, existing.id));
  }

  return { playerId: existing.id, authorized: true };
}

async function upsertPb(playerId: number, boss: string, timeSeconds: number) {
  const existingRows = await db
    .select()
    .from(personalBests)
    .where(eq(personalBests.playerId, playerId));
  const existing = existingRows.find((row) => row.boss === boss);

  if (!existing) {
    await db.insert(personalBests).values({ playerId, boss, timeSeconds, updatedAt: new Date() });
    return true;
  }

  if (timeSeconds < existing.timeSeconds) {
    await db
      .update(personalBests)
      .set({ timeSeconds, updatedAt: new Date() })
      .where(eq(personalBests.id, existing.id));
    return true;
  }

  return false;
}

sync.post('/', async (c) => {
  const body = (await c.req.json().catch(() => null)) as SyncBody | null;
  const accountHash = body?.accountHash;
  const displayName = body?.displayName;
  const installSecret = body?.installSecret;
  const pbs = body?.pbs;

  if (!accountHash || typeof accountHash !== 'string') {
    return c.json({ error: 'accountHash is required' }, 400);
  }
  if (!displayName || typeof displayName !== 'string') {
    return c.json({ error: 'displayName is required' }, 400);
  }
  if (!installSecret || typeof installSecret !== 'string' || installSecret.length < 16) {
    return c.json({ error: 'installSecret is required (min 16 chars)' }, 400);
  }
  if (!pbs || typeof pbs !== 'object' || Array.isArray(pbs)) {
    return c.json({ error: 'pbs must be an object of { bossName: seconds }' }, 400);
  }

  if (isRateLimited(accountHash)) {
    return c.json({ error: 'Too many sync requests for this account, slow down.' }, 429);
  }

  const secretHash = hashSecret(installSecret);
  const { playerId, authorized } = await upsertPlayer(accountHash, displayName, secretHash);

  if (!authorized) {
    return c.json(
      {
        error:
          'This account is already synced from a different install. If this is really you, the original install secret is required.',
      },
      409
    );
  }

  const entries = Object.entries(pbs as Record<string, unknown>);
  let updated = 0;
  for (const [rawBoss, seconds] of entries) {
    const boss = rawBoss.trim().toLowerCase();
    const timeSeconds = Number(seconds);
    if (!boss || !Number.isFinite(timeSeconds) || timeSeconds <= 0) {
      continue;
    }
    if (await upsertPb(playerId, boss, timeSeconds)) {
      updated += 1;
    }
  }

  return c.json({ ok: true, playerId, received: entries.length, updated });
});

export default sync;
