import { count, desc, eq, gte, lt } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../db/client.js';
import { admins, personalBests, players } from '../db/schema.js';
import { verifyPassword } from '../lib/adminPassword.js';
import { isRateLimitExceeded, recordRateLimitAttempt } from '../lib/secret.js';

const admin = new Hono();

function parseBasicAuth(header: string | undefined): { username: string; password: string } | null {
  if (!header || !header.startsWith('Basic ')) {
    return null;
  }
  const decoded = Buffer.from(header.slice('Basic '.length), 'base64').toString('utf8');
  const separatorIndex = decoded.indexOf(':');
  if (separatorIndex === -1) {
    return null;
  }
  return {
    username: decoded.slice(0, separatorIndex),
    password: decoded.slice(separatorIndex + 1),
  };
}

// Not user-facing: no custom login page, just the browser's native Basic
// Auth prompt. Credentials live in the admins table (scrypt hash + salt per
// person), not an env var, so rotating one admin's access doesn't require a
// redeploy or affect anyone else's login.
admin.use('*', async (c, next) => {
  const credentials = parseBasicAuth(c.req.header('Authorization'));
  if (!credentials) {
    return c.json({ error: 'Unauthorized' }, 401, { 'WWW-Authenticate': 'Basic realm="admin"' });
  }

  // Reuses the same throttling window as sync abuse, keyed by username.
  // Only failed auth attempts are recorded below, so normal admin usage does
  // not burn through the login quota. A guessed username can still be locked
  // temporarily; acceptable for this small internal tool.
  const rateLimitKey = `admin-login:${credentials.username}`;
  if (isRateLimitExceeded(rateLimitKey)) {
    return c.json({ error: 'Too many login attempts, slow down.' }, 429);
  }

  const rows = await db.select().from(admins).where(eq(admins.username, credentials.username)).limit(1);
  const account = rows[0];
  // Fails closed: no matching admin row is treated identically to a wrong
  // password, not as "no auth required."
  if (!account || !verifyPassword(credentials.password, account.passwordHash, account.passwordSalt)) {
    recordRateLimitAttempt(rateLimitKey);
    return c.json({ error: 'Unauthorized' }, 401, { 'WWW-Authenticate': 'Basic realm="admin"' });
  }

  await next();
});

admin.get('/players', async (c) => {
  const rows = await db
    .select({
      id: players.id,
      displayName: players.displayName,
      createdAt: players.createdAt,
      lastSyncedAt: players.lastSyncedAt,
      pbCount: count(personalBests.id),
    })
    .from(players)
    .leftJoin(personalBests, eq(personalBests.playerId, players.id))
    .groupBy(players.id, players.displayName, players.createdAt, players.lastSyncedAt)
    .orderBy(desc(players.lastSyncedAt));

  return c.json(
    rows.map((row) => ({
      id: row.id,
      displayName: row.displayName,
      createdAt: row.createdAt.toISOString(),
      lastSyncedAt: row.lastSyncedAt.toISOString(),
      pbCount: Number(row.pbCount),
    }))
  );
});

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

admin.get('/stats', async (c) => {
  const dayAgo = new Date(Date.now() - DAY_MS);
  const weekAgo = new Date(Date.now() - WEEK_MS);

  const [{ totalPlayers }] = await db.select({ totalPlayers: count() }).from(players);
  const [{ totalPbs }] = await db.select({ totalPbs: count() }).from(personalBests);
  const [{ playersSyncedLast24h }] = await db
    .select({ playersSyncedLast24h: count() })
    .from(players)
    .where(gte(players.lastSyncedAt, dayAgo));
  const [{ playersInactive7d }] = await db
    .select({ playersInactive7d: count() })
    .from(players)
    .where(lt(players.lastSyncedAt, weekAgo));

  return c.json({
    totalPlayers: Number(totalPlayers),
    totalPbs: Number(totalPbs),
    playersSyncedLast24h: Number(playersSyncedLast24h),
    playersInactive7d: Number(playersInactive7d),
  });
});

export default admin;
