# Admin Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a login-gated `/admin` panel showing, at a glance, when each player first synced, when they last synced, and how many PBs they have tracked — plus aggregate counters (total players, total PBs, synced-last-24h, inactive-7d+) — replacing the manual SQL digging used to debug the "why didn't Cham's PB show up" question.

**Architecture:** `backend-hono` gets a new `admins` table (per-person scrypt-hashed credentials) and a `/api/admin/*` route group protected by HTTP Basic Auth middleware. `players` gets two new columns — `createdAt` (immutable, set once) and `lastSyncedAt` (rewritten on every successful sync, even a no-op resync) — closing the gap where a routine resync currently touches no timestamp at all. The React frontend gets a new `/admin` route (not linked from any nav) showing a stat row + sortable player table, and `/admin/players/:id` reusing the existing public player-lookup endpoint for a drill-down view.

**Tech Stack:** Hono, Drizzle ORM, Neon Postgres (`backend-hono`), React + Vite (`frontend`), Vitest for both.

**Reference spec:** `docs/superpowers/specs/2026-07-07-admin-panel-design.md`

---

## Important context for whoever executes this plan

- `backend-hono/.env`'s `DATABASE_URL` points at Neon project `dry-tooth-70023755` (the **stale/duplicate** project, not production) — confirmed by matching its pooler host (`c-2.us-west-2.aws.neon.tech`) against `mcp__Neon__list_projects` output. `backend-hono/.env.test` points at a different branch under the same stale project family. **This means locally running `npm run dev` or `npm run db:push` with no override is already safe — it cannot touch production (`snowy-fire-96856162`) by accident.**
- Because of that, every task in this plan that touches the database (schema push, running tests) operates against the safe local/test databases only. **Task 11 is the one exception** — it's the explicit, separately-confirmed step that applies the schema change and creates real admin logins against production. Do not fold Task 11 into any earlier task.
- `drizzle-kit push` is interactive by default (it prompts to confirm each detected change). Since this plan runs non-interactively, every push command below is piped through `yes` to auto-confirm. Read the printed diff in the command output afterward to make sure it did what was expected before moving on.

---

### Task 1: Schema changes — `players.createdAt`/`lastSyncedAt` and the `admins` table

**Files:**
- Modify: `backend-hono/src/db/schema.ts`
- Modify: `backend-hono/test/helpers.ts`

- [ ] **Step 1: Add the new columns and table to the schema**

Edit `backend-hono/src/db/schema.ts`. In the `players` table definition, add two columns after `updatedAt`:

```ts
export const players = pgTable(
  'players',
  {
    id: serial('id').primaryKey(),
    accountHash: text('account_hash').notNull().unique(),
    displayName: text('display_name').notNull(),
    displayNameLower: text('display_name_lower').notNull(),
    installSecretHash: text('install_secret_hash'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
    // Set once at insert, never rewritten again - the true "first sync" date.
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    // Rewritten on every successful sync call, whether or not anything else
    // changed - unlike updatedAt, which only changes on a display name edit.
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    nameLowerIdx: index('idx_players_name_lower').on(table.displayNameLower),
  })
);
```

Then add a new table below `feedback`:

```ts
// Admin panel login credentials. One row per person (not a shared secret) so
// access can be added/revoked per admin. Not exposed via any public route.
export const admins = pgTable('admins', {
  id: serial('id').primaryKey(),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  passwordSalt: text('password_salt').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
```

- [ ] **Step 2: Push the schema to the local dev database**

Run: `cd backend-hono && yes | npx drizzle-kit push`
Expected: output lists `players` gaining `created_at`/`last_synced_at` columns and a new `admins` table being created, ending in a success message. No prompts left hanging (the `yes` pipe auto-answers them).

- [ ] **Step 3: Push the schema to the local test database**

Run:
```bash
cd backend-hono
DATABASE_URL="$(grep '^DATABASE_URL=' .env.test | cut -d '=' -f2-)" bash -c 'yes | npx drizzle-kit push'
```
Expected: same success output as Step 2, applied to the `.env.test` database instead.

- [ ] **Step 4: Extend the test helpers for the new columns and table**

Edit `backend-hono/test/helpers.ts` — replace its full contents with:

```ts
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
```

This references `../src/lib/adminPassword.js`, which doesn't exist yet — that's fine, it's created in Task 2. This file will not compile/run until then, which is expected mid-refactor; Task 2 fixes it.

- [ ] **Step 5: Commit**

```bash
cd backend-hono
git add src/db/schema.ts test/helpers.ts
git commit -m "Add players.createdAt/lastSyncedAt and an admins table"
```

---

### Task 2: Admin password hashing utility

**Files:**
- Create: `backend-hono/src/lib/adminPassword.ts`
- Test: `backend-hono/test/adminPassword.test.ts`

- [ ] **Step 1: Write the failing test**

Create `backend-hono/test/adminPassword.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../src/lib/adminPassword.js';

describe('adminPassword', () => {
  it('verifies a correct password against its hash', () => {
    const { hash, salt } = hashPassword('correct horse battery staple');
    expect(verifyPassword('correct horse battery staple', hash, salt)).toBe(true);
  });

  it('rejects an incorrect password', () => {
    const { hash, salt } = hashPassword('correct horse battery staple');
    expect(verifyPassword('wrong password', hash, salt)).toBe(false);
  });

  it('uses a different salt (and resulting hash) on every call', () => {
    const a = hashPassword('same password');
    const b = hashPassword('same password');
    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).not.toBe(b.hash);
  });

  it('rejects a password checked against the wrong salt', () => {
    const a = hashPassword('same password');
    const b = hashPassword('same password');
    expect(verifyPassword('same password', a.hash, b.salt)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend-hono && npx vitest run test/adminPassword.test.ts`
Expected: FAIL — `Cannot find module '../src/lib/adminPassword.js'`

- [ ] **Step 3: Implement the hashing utility**

Create `backend-hono/src/lib/adminPassword.ts`:

```ts
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

// Node's built-in scrypt: salted and deliberately slow, unlike the plain
// SHA-256 in lib/secret.ts (which is fine for a high-entropy generated
// install secret, but wrong for a human-chosen admin password).
const KEY_LENGTH = 64;

export function hashPassword(password: string): { hash: string; salt: string } {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, KEY_LENGTH).toString('hex');
  return { hash, salt };
}

export function verifyPassword(password: string, hash: string, salt: string): boolean {
  const candidate = scryptSync(password, salt, KEY_LENGTH);
  const stored = Buffer.from(hash, 'hex');
  if (candidate.length !== stored.length) {
    return false;
  }
  return timingSafeEqual(candidate, stored);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend-hono && npx vitest run test/adminPassword.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
cd backend-hono
git add src/lib/adminPassword.ts test/adminPassword.test.ts
git commit -m "Add scrypt-based admin password hashing"
```

---

### Task 3: `create-admin` script

**Files:**
- Create: `backend-hono/scripts/create-admin.ts`
- Modify: `backend-hono/package.json`

- [ ] **Step 1: Write the script**

Create `backend-hono/scripts/create-admin.ts`:

```ts
/**
 * One-off script to create or update an admin login for the admin panel.
 * There's no signup UI - this is how you provision access. Run against a
 * real DATABASE_URL (see Task 11 for the production credentials).
 *
 * Usage:
 *   DATABASE_URL=... npx tsx scripts/create-admin.ts <username> <password>
 */
import { eq } from 'drizzle-orm';
import { db } from '../src/db/client.js';
import { admins } from '../src/db/schema.js';
import { hashPassword } from '../src/lib/adminPassword.js';

async function main() {
  const [username, password] = process.argv.slice(2);
  if (!username || !password) {
    console.error('Usage: tsx scripts/create-admin.ts <username> <password>');
    process.exit(1);
  }
  if (password.length < 12) {
    console.error('Password must be at least 12 characters.');
    process.exit(1);
  }

  const { hash, salt } = hashPassword(password);
  const existing = await db.select().from(admins).where(eq(admins.username, username)).limit(1);

  if (existing[0]) {
    await db
      .update(admins)
      .set({ passwordHash: hash, passwordSalt: salt })
      .where(eq(admins.id, existing[0].id));
    console.log(`Updated password for admin "${username}".`);
  } else {
    await db.insert(admins).values({ username, passwordHash: hash, passwordSalt: salt });
    console.log(`Created admin "${username}".`);
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  }
);
```

- [ ] **Step 2: Register the script in package.json**

Edit `backend-hono/package.json`, add to `"scripts"` (after `"cleanup:untracked-bosses"`):

```json
    "cleanup:untracked-bosses": "tsx scripts/cleanup-untracked-bosses.ts",
    "create-admin": "tsx scripts/create-admin.ts"
```

- [ ] **Step 3: Try it against the local dev database**

Run: `cd backend-hono && npm run create-admin -- steph 'correct horse battery staple local test'`
Expected: `Created admin "steph".`

- [ ] **Step 4: Verify re-running it updates rather than duplicates**

Run: `cd backend-hono && npm run create-admin -- steph 'a different local test password'`
Expected: `Updated password for admin "steph".` (not a duplicate-key error)

- [ ] **Step 5: Commit**

```bash
cd backend-hono
git add scripts/create-admin.ts package.json
git commit -m "Add create-admin script for provisioning admin panel logins"
```

---

### Task 4: Always bump `lastSyncedAt` on sync

**Files:**
- Modify: `backend-hono/src/routes/sync.ts:17-50`
- Modify: `backend-hono/test/sync.test.ts`

- [ ] **Step 1: Write the failing test**

Edit `backend-hono/test/sync.test.ts`. Add these imports at the top (below the existing ones):

```ts
import { eq } from 'drizzle-orm';
import { db } from '../src/db/client.js';
import { players } from '../src/db/schema.js';
```

Add this test inside the existing `describe('POST /api/sync', ...)` block, after the `'only overwrites a PB when the new time is faster'` test:

```ts
  it('bumps lastSyncedAt on every sync, even a no-op resync', async () => {
    const secret = 'a'.repeat(20);
    await syncRequest({ accountHash: 'acct-1', displayName: 'Blitzen', installSecret: secret, pbs: { Zulrah: 80 } });
    const [afterFirst] = await db.select().from(players).where(eq(players.accountHash, 'acct-1'));

    await new Promise((resolve) => setTimeout(resolve, 10));

    await syncRequest({ accountHash: 'acct-1', displayName: 'Blitzen', installSecret: secret, pbs: { Zulrah: 80 } });
    const [afterSecond] = await db.select().from(players).where(eq(players.accountHash, 'acct-1'));

    expect(afterSecond.lastSyncedAt.getTime()).toBeGreaterThan(afterFirst.lastSyncedAt.getTime());
    // updatedAt only changes on a display name edit - it should NOT move on
    // this no-op resync, since that's the exact distinction this feature adds.
    expect(afterSecond.updatedAt.getTime()).toBe(afterFirst.updatedAt.getTime());
  });

  it('does not bump lastSyncedAt on a rejected (wrong-secret) sync attempt', async () => {
    const secret = 'a'.repeat(20);
    await syncRequest({ accountHash: 'acct-1', displayName: 'Blitzen', installSecret: secret, pbs: { Zulrah: 80 } });
    const [before] = await db.select().from(players).where(eq(players.accountHash, 'acct-1'));

    await new Promise((resolve) => setTimeout(resolve, 10));

    const res = await syncRequest({
      accountHash: 'acct-1',
      displayName: 'Blitzen',
      installSecret: 'b'.repeat(20),
      pbs: { Zulrah: 80 },
    });
    expect(res.status).toBe(409);

    const [after] = await db.select().from(players).where(eq(players.accountHash, 'acct-1'));
    expect(after.lastSyncedAt.getTime()).toBe(before.lastSyncedAt.getTime());
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend-hono && npx vitest run test/sync.test.ts`
Expected: FAIL on the new `'bumps lastSyncedAt on every sync...'` test — `lastSyncedAt` won't have moved, since nothing currently rewrites it on a no-op resync.

- [ ] **Step 3: Implement the change**

In `backend-hono/src/routes/sync.ts`, replace the `upsertPlayer` function (lines 17-50) with:

```ts
async function upsertPlayer(accountHash: string, displayName: string, secretHash: string) {
  const displayNameLower = displayName.toLowerCase();
  const existingRows = await db.select().from(players).where(eq(players.accountHash, accountHash)).limit(1);
  const existing = existingRows[0];
  const now = new Date();

  if (!existing) {
    const [inserted] = await db
      .insert(players)
      .values({
        accountHash,
        displayName,
        displayNameLower,
        installSecretHash: secretHash,
        updatedAt: now,
        createdAt: now,
        lastSyncedAt: now,
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
      .set({ displayName, displayNameLower, updatedAt: now, lastSyncedAt: now })
      .where(eq(players.id, existing.id));
  } else {
    // Every other successful sync (even one that changes nothing else)
    // still updates lastSyncedAt - this is the signal the admin panel's
    // "last sync" column depends on. updatedAt is deliberately left alone
    // here; it tracks profile edits, not sync activity.
    await db.update(players).set({ lastSyncedAt: now }).where(eq(players.id, existing.id));
  }

  return { playerId: existing.id, authorized: true };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend-hono && npx vitest run test/sync.test.ts`
Expected: PASS (all tests, including the two new ones)

- [ ] **Step 5: Run the full backend test suite to check for regressions**

Run: `cd backend-hono && npm test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
cd backend-hono
git add src/routes/sync.ts test/sync.test.ts
git commit -m "Always bump players.lastSyncedAt on a successful sync"
```

---

### Task 5: Admin API routes (`/api/admin/players`, `/api/admin/stats`) with Basic Auth

**Files:**
- Create: `backend-hono/src/routes/admin.ts`
- Modify: `backend-hono/src/app.ts`
- Test: `backend-hono/test/admin.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `backend-hono/test/admin.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app.js';
import { resetRateLimiter } from '../src/lib/secret.js';
import { insertTestAdmin, insertTestPlayerWithPb, truncateAll } from './helpers.js';

function basicAuthHeader(username: string, password: string) {
  return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
}

describe('/api/admin', () => {
  beforeEach(async () => {
    await truncateAll();
    resetRateLimiter();
    await insertTestAdmin('steph', 'correct horse battery staple');
  });

  describe('auth', () => {
    it('rejects a request with no credentials', async () => {
      const res = await app.request('/api/admin/players');
      expect(res.status).toBe(401);
      expect(res.headers.get('WWW-Authenticate')).toMatch(/Basic/);
    });

    it('rejects a request with the wrong password', async () => {
      const res = await app.request('/api/admin/players', {
        headers: { Authorization: basicAuthHeader('steph', 'wrong password') },
      });
      expect(res.status).toBe(401);
    });

    it('rejects a request for an unknown username', async () => {
      const res = await app.request('/api/admin/players', {
        headers: { Authorization: basicAuthHeader('nobody', 'whatever') },
      });
      expect(res.status).toBe(401);
    });

    it('accepts a request with correct credentials', async () => {
      const res = await app.request('/api/admin/players', {
        headers: { Authorization: basicAuthHeader('steph', 'correct horse battery staple') },
      });
      expect(res.status).toBe(200);
    });
  });

  describe('GET /players', () => {
    it('returns one row per player with first sync, last sync, and PB count', async () => {
      await insertTestPlayerWithPb({ boss: 'zulrah', timeSeconds: 80, displayName: 'Blitzen' });
      await insertTestPlayerWithPb({ boss: 'vorkath', timeSeconds: 90, displayName: 'Cham' });

      const res = await app.request('/api/admin/players', {
        headers: { Authorization: basicAuthHeader('steph', 'correct horse battery staple') },
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json).toHaveLength(2);
      expect(json[0]).toMatchObject({ displayName: expect.any(String), pbCount: 1 });
      expect(json[0]).toHaveProperty('createdAt');
      expect(json[0]).toHaveProperty('lastSyncedAt');
    });

    it('returns an empty list when there are no players', async () => {
      const res = await app.request('/api/admin/players', {
        headers: { Authorization: basicAuthHeader('steph', 'correct horse battery staple') },
      });
      expect(await res.json()).toEqual([]);
    });
  });

  describe('GET /stats', () => {
    it('computes aggregate counters correctly', async () => {
      await insertTestPlayerWithPb({ boss: 'zulrah', timeSeconds: 80, displayName: 'Blitzen' });
      await insertTestPlayerWithPb({
        boss: 'vorkath',
        timeSeconds: 90,
        displayName: 'Cham',
        lastSyncedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
      });

      const res = await app.request('/api/admin/stats', {
        headers: { Authorization: basicAuthHeader('steph', 'correct horse battery staple') },
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        totalPlayers: 2,
        totalPbs: 2,
        playersSyncedLast24h: 1,
        playersInactive7d: 1,
      });
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend-hono && npx vitest run test/admin.test.ts`
Expected: FAIL — `/api/admin/players` doesn't exist yet (404s, not 401/200 as asserted).

- [ ] **Step 3: Implement the admin routes**

Create `backend-hono/src/routes/admin.ts`:

```ts
import { count, desc, eq, gte, lt } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../db/client.js';
import { admins, personalBests, players } from '../db/schema.js';
import { verifyPassword } from '../lib/adminPassword.js';
import { isRateLimited } from '../lib/secret.js';

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

  // Reuses the same throttling used for sync abuse, keyed by username
  // instead of accountHash, so brute-forcing a password is rate-limited too.
  if (isRateLimited(`admin-login:${credentials.username}`)) {
    return c.json({ error: 'Too many login attempts, slow down.' }, 429);
  }

  const rows = await db.select().from(admins).where(eq(admins.username, credentials.username)).limit(1);
  const account = rows[0];
  // Fails closed: no matching admin row is treated identically to a wrong
  // password, not as "no auth required."
  if (!account || !verifyPassword(credentials.password, account.passwordHash, account.passwordSalt)) {
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
```

- [ ] **Step 4: Mount the route**

In `backend-hono/src/app.ts`, add the import (alphabetically, after the `hono/cors` import block with the other route imports):

```ts
import adminRoute from './routes/admin.js';
```

And mount it (after the `cors()` line, before the other `app.route(...)` calls, so it reads first in the file — placement among the others doesn't affect behavior, just put it with its siblings):

```ts
app.route('/api/admin', adminRoute);
app.route('/api/bosses', bossesRoute);
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd backend-hono && npx vitest run test/admin.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 6: Run the full backend test suite and typecheck**

Run: `cd backend-hono && npm test && npm run typecheck`
Expected: both PASS

- [ ] **Step 7: Commit**

```bash
cd backend-hono
git add src/routes/admin.ts src/app.ts test/admin.test.ts
git commit -m "Add /api/admin/players and /api/admin/stats behind Basic Auth"
```

---

### Task 6: Frontend API client additions

**Files:**
- Modify: `frontend/src/lib/api.ts`
- Test: `frontend/test/api.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `frontend/test/api.test.ts`, inside the existing `describe('createApiClient', ...)` block, after the `'loads recent sync summaries...'` test:

```ts
  it('loads the admin player list', async () => {
    const rows = [{ id: 5, displayName: 'ChampSide', createdAt: '2026-07-05T19:35:04Z', lastSyncedAt: '2026-07-05T19:35:04Z', pbCount: 24 }];
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(rows));
    const api = createApiClient('', fetchFn);
    expect(await api.getAdminPlayers()).toEqual(rows);
    expect(fetchFn).toHaveBeenCalledWith('/api/admin/players');
  });

  it('loads admin stats', async () => {
    const stats = { totalPlayers: 24, totalPbs: 700, playersSyncedLast24h: 6, playersInactive7d: 3 };
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(stats));
    const api = createApiClient('', fetchFn);
    expect(await api.getAdminStats()).toEqual(stats);
    expect(fetchFn).toHaveBeenCalledWith('/api/admin/stats');
  });

  it('throws on an unauthorized admin request', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ error: 'Unauthorized' }, 401));
    const api = createApiClient('', fetchFn);
    await expect(api.getAdminPlayers()).rejects.toThrow();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run test/api.test.ts`
Expected: FAIL — `api.getAdminPlayers is not a function`

- [ ] **Step 3: Implement the client additions**

In `frontend/src/lib/api.ts`, add these interfaces after `RecentSync` (before `export class ApiError`):

```ts
export interface AdminPlayerSummary {
  id: number;
  displayName: string;
  createdAt: string;
  lastSyncedAt: string;
  pbCount: number;
}

export interface AdminStats {
  totalPlayers: number;
  totalPbs: number;
  playersSyncedLast24h: number;
  playersInactive7d: number;
}
```

Add these two methods to the object returned from `createApiClient`, after `getRecentSyncs`:

```ts
    getAdminPlayers(): Promise<AdminPlayerSummary[]> {
      return getJson('/api/admin/players');
    },
    getAdminStats(): Promise<AdminStats> {
      return getJson('/api/admin/stats');
    },
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run test/api.test.ts`
Expected: PASS (all tests, including the 3 new ones)

- [ ] **Step 5: Commit**

```bash
cd frontend
git add src/lib/api.ts test/api.test.ts
git commit -m "Add admin player list and stats to the API client"
```

---

### Task 7: `AdminPage` component (stats row + sortable player table)

**Files:**
- Create: `frontend/src/components/AdminPage.tsx`

- [ ] **Step 1: Implement the component**

Create `frontend/src/components/AdminPage.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { AdminPlayerSummary, AdminStats } from '../lib/api';
import { formatDate } from '../lib/format';
import { EmptyState, ErrorState, Loading } from './States';

type SortKey = 'displayName' | 'createdAt' | 'lastSyncedAt' | 'pbCount';
type SortDir = 'asc' | 'desc';

type State =
  | { s: 'loading' }
  | { s: 'error' }
  | { s: 'loaded'; players: AdminPlayerSummary[]; stats: AdminStats };

function sortPlayers(rows: AdminPlayerSummary[], key: SortKey, dir: SortDir): AdminPlayerSummary[] {
  const sorted = [...rows].sort((a, b) => {
    const av = a[key];
    const bv = b[key];
    if (typeof av === 'number' && typeof bv === 'number') {
      return av - bv;
    }
    return String(av).localeCompare(String(bv));
  });
  return dir === 'asc' ? sorted : sorted.reverse();
}

export function AdminPage({ onSelectPlayer }: { onSelectPlayer: (id: number) => void }) {
  const [state, setState] = useState<State>({ s: 'loading' });
  const [sortKey, setSortKey] = useState<SortKey>('lastSyncedAt');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  useEffect(() => {
    let alive = true;
    Promise.all([api.getAdminPlayers(), api.getAdminStats()])
      .then(([players, stats]) => alive && setState({ s: 'loaded', players, stats }))
      .catch(() => alive && setState({ s: 'error' }));
    return () => {
      alive = false;
    };
  }, []);

  if (state.s === 'loading') return <Loading />;
  if (state.s === 'error') return <ErrorState />;

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const { stats } = state;
  const rows = sortPlayers(state.players, sortKey, sortDir);

  return (
    <section>
      <h2 className="result-title">Admin</h2>

      <div className="admin-stats">
        <div className="admin-stat">
          <span className="admin-stat-value">{stats.totalPlayers}</span>
          <span className="admin-stat-label">Players</span>
        </div>
        <div className="admin-stat">
          <span className="admin-stat-value">{stats.totalPbs}</span>
          <span className="admin-stat-label">PBs tracked</span>
        </div>
        <div className="admin-stat">
          <span className="admin-stat-value">{stats.playersSyncedLast24h}</span>
          <span className="admin-stat-label">Synced last 24h</span>
        </div>
        <div className="admin-stat">
          <span className="admin-stat-value">{stats.playersInactive7d}</span>
          <span className="admin-stat-label">Inactive 7d+</span>
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState>No players synced yet.</EmptyState>
      ) : (
        <table>
          <thead>
            <tr>
              <th className="admin-sortable" onClick={() => toggleSort('displayName')}>
                Player
              </th>
              <th className="admin-sortable" onClick={() => toggleSort('createdAt')}>
                First sync
              </th>
              <th className="admin-sortable" onClick={() => toggleSort('lastSyncedAt')}>
                Last sync
              </th>
              <th className="admin-sortable" onClick={() => toggleSort('pbCount')}>
                PBs
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id} className="admin-row-clickable" onClick={() => onSelectPlayer(p.id)}>
                <td data-label="Player">{p.displayName}</td>
                <td data-label="First sync">{formatDate(p.createdAt)}</td>
                <td data-label="Last sync">{formatDate(p.lastSyncedAt)}</td>
                <td data-label="PBs">{p.pbCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npm run typecheck` (if no such script, run `npx tsc --noEmit`)
Expected: no errors

- [ ] **Step 3: Commit**

```bash
cd frontend
git add src/components/AdminPage.tsx
git commit -m "Add AdminPage: stat row + sortable player table"
```

---

### Task 8: `AdminPlayerDetail` component (drill-down)

**Files:**
- Create: `frontend/src/components/AdminPlayerDetail.tsx`

This reuses the existing public `api.getPlayerById()` (backed by `GET /api/players/by-id/:id`, already returning a player's full `pbs` list) rather than adding a new admin-gated endpoint — the data itself isn't sensitive (it's the same data the public player page already shows), so there's nothing to duplicate.

- [ ] **Step 1: Implement the component**

Create `frontend/src/components/AdminPlayerDetail.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { PlayerLookup } from '../lib/api';
import { formatDate, formatTime, titleCase } from '../lib/format';
import { EmptyState, ErrorState, Loading } from './States';

type State = { s: 'loading' } | { s: 'error' } | { s: 'loaded'; lookup: PlayerLookup };

export function AdminPlayerDetail({ playerId, onBack }: { playerId: number; onBack: () => void }) {
  const [state, setState] = useState<State>({ s: 'loading' });

  useEffect(() => {
    let alive = true;
    setState({ s: 'loading' });
    api
      .getPlayerById(playerId)
      .then((lookup) => alive && setState({ s: 'loaded', lookup }))
      .catch(() => alive && setState({ s: 'error' }));
    return () => {
      alive = false;
    };
  }, [playerId]);

  return (
    <section>
      <button type="button" className="admin-back-link" onClick={onBack}>
        &larr; Back to admin
      </button>

      {state.s === 'loading' && <Loading />}
      {state.s === 'error' && <ErrorState />}
      {state.s === 'loaded' && state.lookup.kind !== 'player' && (
        <EmptyState>Player not found.</EmptyState>
      )}
      {state.s === 'loaded' && state.lookup.kind === 'player' && (
        <>
          <h2 className="result-title">{state.lookup.player.displayName}</h2>
          {state.lookup.player.pbs.length === 0 ? (
            <EmptyState>No tracked PBs for this player.</EmptyState>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Boss</th>
                  <th>Personal Best</th>
                  <th>Recorded</th>
                </tr>
              </thead>
              <tbody>
                {state.lookup.player.pbs.map((pb) => (
                  <tr key={pb.boss}>
                    <td data-label="Boss">{titleCase(pb.boss)}</td>
                    <td className="time" data-label="Personal Best">
                      {formatTime(pb.timeSeconds)}
                    </td>
                    <td data-label="Recorded">{formatDate(pb.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </section>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
cd frontend
git add src/components/AdminPlayerDetail.tsx
git commit -m "Add AdminPlayerDetail drill-down view"
```

---

### Task 9: Wire up `/admin` and `/admin/players/:id` routing

**Files:**
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Add the imports**

In `frontend/src/App.tsx`, add after the `PhaseTwoPreview` import:

```ts
import { AdminPage } from './components/AdminPage';
import { AdminPlayerDetail } from './components/AdminPlayerDetail';
```

- [ ] **Step 2: Extend the `View` type**

Replace the `View` type definition with:

```ts
type View =
  | { name: 'home' }
  | { name: 'player'; player: string }
  | { name: 'boss'; boss: string; highlight?: string }
  | { name: 'faq' }
  | { name: 'setup' }
  | { name: 'phase2Preview' }
  | { name: 'admin' }
  | { name: 'adminPlayer'; playerId: number };
```

- [ ] **Step 3: Extend `viewFromLocation`**

Replace `viewFromLocation` with:

```ts
function viewFromLocation(): View {
  const path = window.location.pathname;
  const playerMatch = path.match(/^\/player\/(.+)$/);
  if (playerMatch) return { name: 'player', player: decodeURIComponent(playerMatch[1]) };
  const bossMatch = path.match(/^\/boss\/(.+)$/);
  if (bossMatch) {
    const highlight = new URLSearchParams(window.location.search).get('highlight') ?? undefined;
    return { name: 'boss', boss: decodeURIComponent(bossMatch[1]), highlight };
  }
  const adminPlayerMatch = path.match(/^\/admin\/players\/(\d+)$/);
  if (adminPlayerMatch) return { name: 'adminPlayer', playerId: Number(adminPlayerMatch[1]) };
  if (path === '/admin') return { name: 'admin' };
  if (path === '/faq') return { name: 'faq' };
  if (path === '/setup') return { name: 'setup' };
  if (path === '/phase-two-preview') return { name: 'phase2Preview' };
  return { name: 'home' };
}
```

- [ ] **Step 4: Extend `navigate`'s path building**

Replace the `navigate` function's path expression with:

```ts
  const navigate = (next: View) => {
    const path =
      next.name === 'player'
        ? `/player/${encodeURIComponent(next.player)}`
        : next.name === 'boss'
          ? `/boss/${encodeURIComponent(next.boss)}${next.highlight ? `?highlight=${encodeURIComponent(next.highlight)}` : ''}`
          : next.name === 'faq'
            ? '/faq'
            : next.name === 'setup'
              ? '/setup'
              : next.name === 'phase2Preview'
                ? '/phase-two-preview'
                : next.name === 'admin'
                  ? '/admin'
                  : next.name === 'adminPlayer'
                    ? `/admin/players/${next.playerId}`
                    : '/';
    window.history.pushState({}, '', path);
    setView(next);
  };
```

- [ ] **Step 5: Add the admin render branch**

Add this block immediately after the existing `if (view.name === 'phase2Preview') { ... }` block (before `return ( <> ... site-header ... )`):

```tsx
  if (view.name === 'admin' || view.name === 'adminPlayer') {
    return (
      <>
        <header className="site-header">
          <div className="wrap">
            <a
              href="/"
              className="logo-link"
              onClick={(e) => {
                e.preventDefault();
                navigate({ name: 'home' });
              }}
            >
              <h1>
                <span className="accent">PB</span> Tracker <span className="accent">Admin</span>
              </h1>
            </a>
          </div>
        </header>
        <main className="wrap">
          {view.name === 'admin' ? (
            <AdminPage onSelectPlayer={(id) => navigate({ name: 'adminPlayer', playerId: id })} />
          ) : (
            <AdminPlayerDetail playerId={view.playerId} onBack={() => navigate({ name: 'admin' })} />
          )}
        </main>
      </>
    );
  }
```

Note: this is *not* linked from the site header, footer, or any nav — it's reachable only by navigating directly to `/admin`, matching the spec's "not user-facing" requirement.

- [ ] **Step 6: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 7: Commit**

```bash
cd frontend
git add src/App.tsx
git commit -m "Wire up /admin and /admin/players/:id routes"
```

---

### Task 10: Admin panel styling

**Files:**
- Modify: `frontend/src/theme.css`

- [ ] **Step 1: Append the admin styles**

Add to the end of `frontend/src/theme.css`:

```css
.admin-stats { display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 20px; }

.admin-stat {
  background: var(--panel);
  border: 1px solid var(--panel-border);
  border-radius: 8px;
  padding: 12px 20px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 120px;
}

.admin-stat-value { font-size: 1.6rem; font-weight: 700; color: var(--gold-light); }
.admin-stat-label { font-size: 0.8rem; color: var(--text-dim); }

.admin-sortable { cursor: pointer; user-select: none; }
.admin-sortable:hover { color: var(--gold-light); }

.admin-row-clickable { cursor: pointer; }
.admin-row-clickable:hover td { background: #100d09; }

.admin-back-link {
  background: none;
  border: none;
  color: var(--text-dim);
  cursor: pointer;
  padding: 0;
  margin-bottom: 12px;
  font-size: 0.9rem;
}
.admin-back-link:hover { color: var(--gold); }
```

- [ ] **Step 2: Visually verify**

Run: `cd frontend && npm run dev`, navigate to `http://localhost:5173/admin` (create a local admin first via Task 3's script against whichever DB your local backend is pointed at, and run the backend dev server too). Confirm: browser's native Basic Auth prompt appears, entering the credentials shows the stat row and table, clicking a column header re-sorts, clicking a row navigates to the player detail view.

- [ ] **Step 3: Commit**

```bash
cd frontend
git add src/theme.css
git commit -m "Style the admin panel stat tiles and sortable table"
```

---

### Task 11: Deploy to production — schema push and real admin logins

**This task touches production. Confirm with Steph before running any step in it.**

**Files:** none (operational task only)

- [ ] **Step 1: Get the production `DATABASE_URL`**

Per project convention, Claude cannot fetch this via the Neon MCP (`get_connection_string` is blocked as credential materialization). Ask Steph to copy the connection string for Neon project `snowy-fire-96856162`, branch `main`, from the Neon console.

- [ ] **Step 2: Push the schema to production**

With that connection string as `DATABASE_URL`:

```bash
cd backend-hono
DATABASE_URL='<production-connection-string>' bash -c 'yes | npx drizzle-kit push'
```

Expected: output confirms `players` gained `created_at`/`last_synced_at` (backfilled via `DEFAULT now()` to the push execution time for all ~24 existing rows — this is the approximation documented in the spec, not their true original sync dates) and `admins` was created. Read the diff before confirming it matches expectations.

- [ ] **Step 3: Create the real admin logins**

```bash
cd backend-hono
DATABASE_URL='<production-connection-string>' npm run create-admin -- <steph-username> '<a real password, 12+ chars>'
DATABASE_URL='<production-connection-string>' npm run create-admin -- <george-username> '<a real password, 12+ chars>'
```

- [ ] **Step 4: Verify against the live site**

Since the backend is already deployed (this task only changed the database, not the code — Task 11 assumes Tasks 1-10 have already been pushed/merged/deployed through the normal `dev` → review → `main` flow first), visit `https://osrs-pb-tracker-frontend.vercel.app/admin`, enter the credentials from Step 3, and confirm the stat row and player table load with real data.

- [ ] **Step 5: Note the credentials were set**

No commit for this task — it's a database/ops change, not a code change. Let Steph and George know their login was created (not the password itself — that's between the operator and whoever's password it is).

---

## Self-review notes

- **Spec coverage:** every section of `docs/superpowers/specs/2026-07-07-admin-panel-design.md` maps to a task — data model (Task 1), auth/hashing (Tasks 2-3, 5), API (Task 5), `lastSyncedAt` sync fix (Task 4), frontend (Tasks 6-10), production rollout (Task 11). The spec's "out of scope for v1" items (configurable thresholds, pagination, custom login page, full event log) are correctly absent from every task.
- **Deviation from spec, called out explicitly:** the spec listed `GET /api/admin/players/:id` as a new endpoint; Task 8 instead reuses the existing public `GET /api/players/by-id/:id`, since it already returns everything the drill-down needs and the data isn't sensitive. This avoids a redundant endpoint without losing any required information.
- **Type consistency check:** `AdminPlayerSummary` (frontend, Task 6) matches the exact shape returned by `/api/admin/players` (backend, Task 5) — `id`, `displayName`, `createdAt`, `lastSyncedAt`, `pbCount`. `AdminStats` matches `/api/admin/stats`'s four fields exactly. `AdminPlayerDetail` (Task 8) consumes `PlayerLookup`/`PlayerPayload`, which already exist and are unchanged.
- **No placeholders:** every step has complete, runnable code or an exact command with expected output.
