# Hono Backend Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Express + local-SQLite backend with a TypeScript Hono backend on Neon Postgres, deployable to Vercel, with exact API contract parity so the existing static website and RuneLite plugin keep working unchanged.

**Architecture:** A new `backend-hono/` directory next to the existing `backend/` (which stays running untouched until cutover). One shared Hono app (`src/app.ts`) is wrapped by two thin entrypoints — `@hono/node-server` for local dev, `hono/vercel` for deployment. Data access goes through Drizzle ORM against Neon Postgres via the HTTP driver.

**Tech Stack:** Hono, TypeScript, `@hono/node-server`, `@neondatabase/serverless`, Drizzle ORM + drizzle-kit, Vitest, tsx.

Full design rationale lives in `docs/superpowers/specs/2026-07-03-hono-backend-rebuild-design.md`.

---

## File Structure

```
osrs-pb-tracker/
  backend-hono/
    package.json
    tsconfig.json
    drizzle.config.ts
    vitest.config.ts
    .env.example
    src/
      db/
        schema.ts        # Drizzle table definitions (players, personal_bests)
        client.ts         # Neon connection + Drizzle instance
      lib/
        secret.ts         # hashSecret() + isRateLimited() + resetRateLimiter()
      routes/
        sync.ts           # POST /
        players.ts         # GET /:name, GET /by-id/:id
        search.ts          # GET /
        leaderboard.ts      # GET /:boss
        bosses.ts          # GET /
      app.ts              # Assembles the Hono app, mounts routes, onError
      index.node.ts        # Local dev entrypoint (@hono/node-server + static site)
    api/
      index.ts            # Vercel entrypoint (hono/vercel adapter)
    drizzle/               # drizzle-kit generated migrations (created by db:generate)
    test/
      setup.ts             # Loads .env.test before any test file imports the app
      helpers.ts           # truncateAll(), insertTestPlayerWithPb()
      secret.test.ts
      bosses.test.ts
      search.test.ts
      leaderboard.test.ts
      players.test.ts
      sync.test.ts
```

Each route file owns exactly one resource. `lib/secret.ts` is deliberately DB-free so it can be unit-tested without touching Postgres at all.

---

### Task 1: Scaffold the project

**Files:**
- Create: `backend-hono/package.json`
- Create: `backend-hono/tsconfig.json`
- Create: `backend-hono/.env.example`
- Create: `backend-hono/.gitignore`
- Modify: `.gitignore` (repo root)

- [ ] **Step 1: Create the package.json**

```json
{
  "name": "pb-tracker-backend-hono",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.node.ts",
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "db:generate": "drizzle-kit generate",
    "db:push": "drizzle-kit push"
  },
  "dependencies": {
    "hono": "^4.6.0",
    "@hono/node-server": "^1.13.0",
    "@neondatabase/serverless": "^0.10.0",
    "drizzle-orm": "^0.36.0"
  },
  "devDependencies": {
    "drizzle-kit": "^0.28.0",
    "typescript": "^5.6.0",
    "tsx": "^4.19.0",
    "vitest": "^2.1.0",
    "dotenv": "^16.4.0",
    "@types/node": "^22.7.0"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "types": ["node"]
  },
  "include": ["src", "api", "test", "drizzle.config.ts", "vitest.config.ts"]
}
```

- [ ] **Step 3: Create .env.example**

```
DATABASE_URL=postgres://user:password@host/dbname?sslmode=require
```

- [ ] **Step 4: Create backend-hono/.gitignore**

```
node_modules/
dist/
.env
.env.test
```

- [ ] **Step 5: Install dependencies**

Run: `cd backend-hono && npm install`
Expected: `node_modules/` created, `package-lock.json` created, no errors.

- [ ] **Step 6: Commit**

```bash
cd "osrs-pb-tracker"
git add backend-hono/package.json backend-hono/package-lock.json backend-hono/tsconfig.json backend-hono/.env.example backend-hono/.gitignore
git commit -m "Scaffold backend-hono project"
```

---

### Task 2: Secret hashing + rate limiter (TDD, no DB required)

**Files:**
- Create: `backend-hono/src/lib/secret.ts`
- Test: `backend-hono/test/secret.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `backend-hono/test/secret.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { hashSecret, isRateLimited, resetRateLimiter } from '../src/lib/secret';

describe('hashSecret', () => {
  it('produces a stable sha256 hex digest', () => {
    expect(hashSecret('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    );
  });

  it('produces different hashes for different inputs', () => {
    expect(hashSecret('abc')).not.toBe(hashSecret('abd'));
  });
});

describe('isRateLimited', () => {
  it('allows requests under the limit', () => {
    resetRateLimiter();
    for (let i = 0; i < 30; i += 1) {
      expect(isRateLimited('key-a')).toBe(false);
    }
  });

  it('blocks the 31st request within the window', () => {
    resetRateLimiter();
    for (let i = 0; i < 30; i += 1) {
      isRateLimited('key-b');
    }
    expect(isRateLimited('key-b')).toBe(true);
  });

  it('resets after the window passes', () => {
    resetRateLimiter();
    const start = 1_000_000;
    for (let i = 0; i < 30; i += 1) {
      isRateLimited('key-c', start);
    }
    expect(isRateLimited('key-c', start + 11 * 60 * 1000)).toBe(false);
  });

  it('tracks separate keys independently', () => {
    resetRateLimiter();
    for (let i = 0; i < 30; i += 1) {
      isRateLimited('key-d');
    }
    expect(isRateLimited('key-e')).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend-hono && npx vitest run test/secret.test.ts`
Expected: FAIL — `Cannot find module '../src/lib/secret'`

- [ ] **Step 3: Implement lib/secret.ts**

Create `backend-hono/src/lib/secret.ts`:

```typescript
import { createHash } from 'node:crypto';

// RuneLite gives plugins no way to cryptographically prove account identity
// to a third-party server. Instead of proving identity, the caller sends a
// per-install secret and we bind it to an accountHash on first sync (TOFU
// claim) - see routes/sync.ts. We only ever store/compare the hash, never
// the raw secret.
export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 30;
const syncRequestTimestamps = new Map<string, number[]>();

// nowMs is injectable so tests can simulate the window passing without
// real sleeps.
export function isRateLimited(key: string, nowMs: number = Date.now()): boolean {
  const recent = (syncRequestTimestamps.get(key) ?? []).filter(
    (t) => nowMs - t < RATE_LIMIT_WINDOW_MS
  );
  recent.push(nowMs);
  syncRequestTimestamps.set(key, recent);
  return recent.length > RATE_LIMIT_MAX_REQUESTS;
}

export function resetRateLimiter(): void {
  syncRequestTimestamps.clear();
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend-hono && npx vitest run test/secret.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
cd "osrs-pb-tracker"
git add backend-hono/src/lib/secret.ts backend-hono/test/secret.test.ts
git commit -m "Add secret hashing and rate limiter lib with tests"
```

---

### Task 3: Provision Neon databases (dev + test)

**Files:**
- Create: `backend-hono/.env` (not committed — gitignored)
- Create: `backend-hono/.env.test` (not committed — gitignored)

- [ ] **Step 1: Create a Neon project**

If the Neon MCP connector is available, use it to create a new project named `osrs-pb-tracker` and retrieve the pooled connection string for its default branch. If it isn't available, create the project manually at https://console.neon.tech and copy the connection string from the dashboard.

- [ ] **Step 2: Write the dev connection string to .env**

Create `backend-hono/.env`:

```
DATABASE_URL=<paste the default branch's pooled connection string here>
```

- [ ] **Step 3: Create a "test" branch off the same Neon project**

Using the Neon MCP connector (or the console), create a branch named `test`. Retrieve its own pooled connection string — branches are isolated copies of the schema/data, so tests never touch dev data.

- [ ] **Step 4: Write the test connection string to .env.test**

Create `backend-hono/.env.test`:

```
DATABASE_URL=<paste the "test" branch's pooled connection string here>
```

- [ ] **Step 5: Verify both files exist and are gitignored**

Run: `cd "osrs-pb-tracker" && git status --short backend-hono/`
Expected: Neither `.env` nor `.env.test` appear in the output (they're ignored by `backend-hono/.gitignore` from Task 1).

No commit for this task — nothing here is tracked by git.

---

### Task 4: Drizzle schema + DB client

**Files:**
- Create: `backend-hono/src/db/schema.ts`
- Create: `backend-hono/src/db/client.ts`
- Create: `backend-hono/drizzle.config.ts`

- [ ] **Step 1: Write the schema**

Create `backend-hono/src/db/schema.ts`:

```typescript
import { pgTable, serial, integer, text, real, timestamp, unique } from 'drizzle-orm/pg-core';

export const players = pgTable('players', {
  id: serial('id').primaryKey(),
  accountHash: text('account_hash').notNull().unique(),
  displayName: text('display_name').notNull(),
  displayNameLower: text('display_name_lower').notNull(),
  installSecretHash: text('install_secret_hash'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});

export const personalBests = pgTable(
  'personal_bests',
  {
    id: serial('id').primaryKey(),
    playerId: integer('player_id')
      .notNull()
      .references(() => players.id, { onDelete: 'cascade' }),
    boss: text('boss').notNull(),
    timeSeconds: real('time_seconds').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => ({
    playerBossUnique: unique().on(table.playerId, table.boss),
  })
);
```

Note: boss names are always lowercased before being written (see `routes/sync.ts` in Task 9), so no Postgres collation tricks are needed for case-insensitive comparisons — plain equality/`LIKE` on the stored lowercase value is enough, matching how `display_name_lower` already works in the current SQLite schema.

- [ ] **Step 2: Write the DB client**

Create `backend-hono/src/db/client.ts`:

```typescript
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './schema';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL environment variable is required');
}

const sql = neon(connectionString);
export const db = drizzle(sql, { schema });
```

- [ ] **Step 3: Write the drizzle-kit config**

Create `backend-hono/drizzle.config.ts`:

```typescript
import { defineConfig } from 'drizzle-kit';
import { config } from 'dotenv';

config();

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
```

- [ ] **Step 4: Push the schema to the dev Neon database**

Run: `cd backend-hono && npx drizzle-kit push`
Expected: Prompts to confirm creating `players` and `personal_bests` tables; confirm yes. Output ends with something like "Changes applied".

- [ ] **Step 5: Push the schema to the test Neon branch**

Run: `cd backend-hono && DATABASE_URL=$(grep DATABASE_URL .env.test | cut -d '=' -f2-) npx drizzle-kit push`
Expected: Same table creation, applied to the test branch this time.

- [ ] **Step 6: Commit**

```bash
cd "osrs-pb-tracker"
git add backend-hono/src/db/schema.ts backend-hono/src/db/client.ts backend-hono/drizzle.config.ts
git commit -m "Add Drizzle schema and Neon DB client"
```

---

### Task 5: Test infrastructure (setup + helpers)

**Files:**
- Create: `backend-hono/vitest.config.ts`
- Create: `backend-hono/test/setup.ts`
- Create: `backend-hono/test/helpers.ts`

- [ ] **Step 1: Write the Vitest config**

Create `backend-hono/vitest.config.ts`:

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['./test/setup.ts'],
    fileParallelism: false,
  },
});
```

`fileParallelism: false` matters here: every test file shares the same Neon test branch, so running files in parallel would cause them to truncate each other's data mid-test.

- [ ] **Step 2: Write the setup file**

Create `backend-hono/test/setup.ts`:

```typescript
import { config } from 'dotenv';

config({ path: '.env.test' });
```

This must run before any test file imports `src/app.ts` (which transitively imports `src/db/client.ts` and reads `process.env.DATABASE_URL` at import time) — Vitest guarantees `setupFiles` run first, which is why this works without every test file needing its own dotenv call.

- [ ] **Step 3: Write the test helpers**

Create `backend-hono/test/helpers.ts`:

```typescript
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
      updatedAt: new Date(),
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
```

- [ ] **Step 4: Verify the test DB connection works**

Run: `cd backend-hono && npx vitest run test/secret.test.ts`
Expected: Still passes (this task didn't touch secret.ts, just confirms the config change didn't break anything).

- [ ] **Step 5: Commit**

```bash
cd "osrs-pb-tracker"
git add backend-hono/vitest.config.ts backend-hono/test/setup.ts backend-hono/test/helpers.ts
git commit -m "Add test infrastructure for Neon-backed integration tests"
```

---

### Task 6: Hono app skeleton + entrypoints

**Files:**
- Create: `backend-hono/src/app.ts`
- Create: `backend-hono/src/index.node.ts`
- Create: `backend-hono/api/index.ts`

- [ ] **Step 1: Write the app skeleton (no routes yet)**

Create `backend-hono/src/app.ts`:

```typescript
import { Hono } from 'hono';
import { cors } from 'hono/cors';

export const app = new Hono();

app.use('*', cors());

app.onError((err, c) => {
  console.error('Unhandled error', err);
  return c.json({ error: 'Internal error' }, 500);
});
```

- [ ] **Step 2: Write the local dev entrypoint**

Create `backend-hono/src/index.node.ts`:

```typescript
import 'dotenv/config';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { app } from './app';

// Serves the existing static website during local dev, matching what the
// Express backend does today. This goes away once the Vite frontend
// sub-project replaces the static site - not carried over to the Vercel
// deployment in Task 13.
app.use('/*', serveStatic({ root: '../website' }));

const port = Number(process.env.PORT) || 3000;
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`PB tracker backend (Hono) listening on http://localhost:${info.port}`);
});
```

- [ ] **Step 3: Write the Vercel entrypoint**

Create `backend-hono/api/index.ts`:

```typescript
import { handle } from 'hono/vercel';
import { app } from '../src/app';

export const runtime = 'nodejs';

export default handle(app);
```

- [ ] **Step 4: Verify the dev server boots**

Run: `cd backend-hono && npm run dev`
Expected: Console prints `PB tracker backend (Hono) listening on http://localhost:3000` with no errors. Stop it with Ctrl+C once confirmed.

- [ ] **Step 5: Commit**

```bash
cd "osrs-pb-tracker"
git add backend-hono/src/app.ts backend-hono/src/index.node.ts backend-hono/api/index.ts
git commit -m "Add Hono app skeleton with local dev and Vercel entrypoints"
```

---

### Task 7: GET /api/bosses

**Files:**
- Create: `backend-hono/src/routes/bosses.ts`
- Modify: `backend-hono/src/app.ts`
- Test: `backend-hono/test/bosses.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `backend-hono/test/bosses.test.ts`:

```typescript
import { describe, expect, it, beforeEach } from 'vitest';
import { app } from '../src/app';
import { truncateAll, insertTestPlayerWithPb } from './helpers';

describe('GET /api/bosses', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('returns an empty array when nothing is synced', async () => {
    const res = await app.request('/api/bosses');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it('returns distinct boss names sorted alphabetically', async () => {
    await insertTestPlayerWithPb({ boss: 'zulrah', timeSeconds: 80 });
    await insertTestPlayerWithPb({ boss: 'vorkath', timeSeconds: 143 });

    const res = await app.request('/api/bosses');
    expect(await res.json()).toEqual(['vorkath', 'zulrah']);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend-hono && npx vitest run test/bosses.test.ts`
Expected: FAIL — 404 status, route doesn't exist yet.

- [ ] **Step 3: Implement the route**

Create `backend-hono/src/routes/bosses.ts`:

```typescript
import { Hono } from 'hono';
import { db } from '../db/client';
import { personalBests } from '../db/schema';

const bosses = new Hono();

bosses.get('/', async (c) => {
  const rows = await db
    .selectDistinct({ boss: personalBests.boss })
    .from(personalBests)
    .orderBy(personalBests.boss);

  return c.json(rows.map((r) => r.boss));
});

export default bosses;
```

- [ ] **Step 4: Mount the route in app.ts**

Modify `backend-hono/src/app.ts` — add the import and mount line:

```typescript
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import bossesRoute from './routes/bosses';

export const app = new Hono();

app.use('*', cors());

app.route('/api/bosses', bossesRoute);

app.onError((err, c) => {
  console.error('Unhandled error', err);
  return c.json({ error: 'Internal error' }, 500);
});
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd backend-hono && npx vitest run test/bosses.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 6: Commit**

```bash
cd "osrs-pb-tracker"
git add backend-hono/src/routes/bosses.ts backend-hono/src/app.ts backend-hono/test/bosses.test.ts
git commit -m "Add GET /api/bosses"
```

---

### Task 8: GET /api/search

**Files:**
- Create: `backend-hono/src/routes/search.ts`
- Modify: `backend-hono/src/app.ts`
- Test: `backend-hono/test/search.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `backend-hono/test/search.test.ts`:

```typescript
import { describe, expect, it, beforeEach } from 'vitest';
import { app } from '../src/app';
import { truncateAll, insertTestPlayerWithPb } from './helpers';

describe('GET /api/search', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('returns an empty array with no query', async () => {
    const res = await app.request('/api/search');
    expect(await res.json()).toEqual([]);
  });

  it('returns matching display names', async () => {
    await insertTestPlayerWithPb({ boss: 'zulrah', timeSeconds: 80, displayName: 'Blitzen' });
    const res = await app.request('/api/search?q=blit');
    expect(await res.json()).toEqual(['Blitzen']);
  });

  it('does not match unrelated names', async () => {
    await insertTestPlayerWithPb({ boss: 'zulrah', timeSeconds: 80, displayName: 'Blitzen' });
    const res = await app.request('/api/search?q=zzz');
    expect(await res.json()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend-hono && npx vitest run test/search.test.ts`
Expected: FAIL — 404, route doesn't exist yet.

- [ ] **Step 3: Implement the route**

Create `backend-hono/src/routes/search.ts`:

```typescript
import { Hono } from 'hono';
import { like } from 'drizzle-orm';
import { db } from '../db/client';
import { players } from '../db/schema';

const search = new Hono();

search.get('/', async (c) => {
  const q = (c.req.query('q') ?? '').toLowerCase().trim();
  if (!q) {
    return c.json([]);
  }

  const rows = await db
    .select({ displayName: players.displayName })
    .from(players)
    .where(like(players.displayNameLower, `%${q}%`))
    .orderBy(players.displayNameLower)
    .limit(10);

  return c.json(rows.map((r) => r.displayName));
});

export default search;
```

- [ ] **Step 4: Mount the route in app.ts**

Modify `backend-hono/src/app.ts` — add the import and mount line (alongside the existing bosses route):

```typescript
import searchRoute from './routes/search';
// ...
app.route('/api/search', searchRoute);
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd backend-hono && npx vitest run test/search.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 6: Commit**

```bash
cd "osrs-pb-tracker"
git add backend-hono/src/routes/search.ts backend-hono/src/app.ts backend-hono/test/search.test.ts
git commit -m "Add GET /api/search"
```

---

### Task 9: GET /api/leaderboard/:boss

**Files:**
- Create: `backend-hono/src/routes/leaderboard.ts`
- Modify: `backend-hono/src/app.ts`
- Test: `backend-hono/test/leaderboard.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `backend-hono/test/leaderboard.test.ts`:

```typescript
import { describe, expect, it, beforeEach } from 'vitest';
import { app } from '../src/app';
import { truncateAll, insertTestPlayerWithPb } from './helpers';

describe('GET /api/leaderboard/:boss', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('returns an empty array when nobody has synced that boss', async () => {
    const res = await app.request('/api/leaderboard/zulrah');
    expect(await res.json()).toEqual([]);
  });

  it('sorts fastest time first', async () => {
    await insertTestPlayerWithPb({ boss: 'zulrah', timeSeconds: 100, displayName: 'Slow' });
    await insertTestPlayerWithPb({ boss: 'zulrah', timeSeconds: 80, displayName: 'Fast' });

    const res = await app.request('/api/leaderboard/zulrah');
    const json = (await res.json()) as Array<{ displayName: string }>;
    expect(json.map((r) => r.displayName)).toEqual(['Fast', 'Slow']);
  });

  it('clamps limit to a maximum of 100', async () => {
    const res = await app.request('/api/leaderboard/zulrah?limit=99999');
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend-hono && npx vitest run test/leaderboard.test.ts`
Expected: FAIL — 404, route doesn't exist yet.

- [ ] **Step 3: Implement the route**

Create `backend-hono/src/routes/leaderboard.ts`:

```typescript
import { Hono } from 'hono';
import { eq, asc } from 'drizzle-orm';
import { db } from '../db/client';
import { players, personalBests } from '../db/schema';

const leaderboard = new Hono();

leaderboard.get('/:boss', async (c) => {
  const boss = c.req.param('boss').toLowerCase();
  const limitParam = Number(c.req.query('limit'));
  const limit = Math.min(Number.isFinite(limitParam) && limitParam > 0 ? limitParam : 25, 100);

  const rows = await db
    .select({
      displayName: players.displayName,
      timeSeconds: personalBests.timeSeconds,
      updatedAt: personalBests.updatedAt,
    })
    .from(personalBests)
    .innerJoin(players, eq(players.id, personalBests.playerId))
    .where(eq(personalBests.boss, boss))
    .orderBy(asc(personalBests.timeSeconds))
    .limit(limit);

  return c.json(rows);
});

export default leaderboard;
```

- [ ] **Step 4: Mount the route in app.ts**

Modify `backend-hono/src/app.ts` — add the import and mount line:

```typescript
import leaderboardRoute from './routes/leaderboard';
// ...
app.route('/api/leaderboard', leaderboardRoute);
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd backend-hono && npx vitest run test/leaderboard.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 6: Commit**

```bash
cd "osrs-pb-tracker"
git add backend-hono/src/routes/leaderboard.ts backend-hono/src/app.ts backend-hono/test/leaderboard.test.ts
git commit -m "Add GET /api/leaderboard/:boss"
```

---

### Task 10: GET /api/players/:name and GET /api/players/by-id/:id

**Files:**
- Create: `backend-hono/src/routes/players.ts`
- Modify: `backend-hono/src/app.ts`
- Test: `backend-hono/test/players.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `backend-hono/test/players.test.ts`:

```typescript
import { describe, expect, it, beforeEach } from 'vitest';
import { app } from '../src/app';
import { truncateAll, insertTestPlayerWithPb } from './helpers';

describe('GET /api/players/:name', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('returns 404 for an unknown player', async () => {
    const res = await app.request('/api/players/Nobody');
    expect(res.status).toBe(404);
  });

  it('returns a single player with their PBs', async () => {
    await insertTestPlayerWithPb({ boss: 'zulrah', timeSeconds: 80, displayName: 'Blitzen' });
    const res = await app.request('/api/players/blitzen');
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.displayName).toBe('Blitzen');
    expect(json.pbs).toEqual([
      { boss: 'zulrah', timeSeconds: 80, updatedAt: expect.any(String) },
    ]);
  });

  it('returns an ambiguous match list when two players share a name', async () => {
    await insertTestPlayerWithPb({
      boss: 'zulrah', timeSeconds: 80, displayName: 'Blitzen', accountHash: 'a',
    });
    await insertTestPlayerWithPb({
      boss: 'vorkath', timeSeconds: 143, displayName: 'Blitzen', accountHash: 'b',
    });

    const res = await app.request('/api/players/blitzen');
    const json = await res.json();
    expect(json.ambiguous).toBe(true);
    expect(json.matches).toHaveLength(2);
  });
});

describe('GET /api/players/by-id/:id', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('returns 404 for an unknown id', async () => {
    const res = await app.request('/api/players/by-id/999999');
    expect(res.status).toBe(404);
  });

  it('returns the player matching that id', async () => {
    const player = await insertTestPlayerWithPb({ boss: 'zulrah', timeSeconds: 80, displayName: 'Blitzen' });
    const res = await app.request(`/api/players/by-id/${player.id}`);
    expect(res.status).toBe(200);
    expect((await res.json()).displayName).toBe('Blitzen');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend-hono && npx vitest run test/players.test.ts`
Expected: FAIL — 404 for everything, route doesn't exist yet.

- [ ] **Step 3: Implement the route**

Create `backend-hono/src/routes/players.ts`:

```typescript
import { Hono } from 'hono';
import { eq, desc } from 'drizzle-orm';
import { db } from '../db/client';
import { players, personalBests } from '../db/schema';

const playersRoute = new Hono();

async function playerWithPbs(player: typeof players.$inferSelect) {
  const pbs = await db
    .select({
      boss: personalBests.boss,
      timeSeconds: personalBests.timeSeconds,
      updatedAt: personalBests.updatedAt,
    })
    .from(personalBests)
    .where(eq(personalBests.playerId, player.id))
    .orderBy(personalBests.boss);

  return {
    id: player.id,
    displayName: player.displayName,
    updatedAt: player.updatedAt,
    pbs,
  };
}

// Registered before '/:name' - Hono matches in registration order, and
// '/:name' would otherwise swallow "by-id" as a name param.
playersRoute.get('/by-id/:id', async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) {
    return c.json({ error: 'Player not found' }, 404);
  }

  const rows = await db.select().from(players).where(eq(players.id, id)).limit(1);
  const player = rows[0];
  if (!player) {
    return c.json({ error: 'Player not found' }, 404);
  }

  return c.json(await playerWithPbs(player));
});

// Display names aren't unique (players can rename in-game, and old names
// get reused), so more than one player row can share the same
// displayNameLower. Rather than arbitrarily picking one match, surface all
// of them and let the caller disambiguate via GET /by-id/:id.
playersRoute.get('/:name', async (c) => {
  const nameLower = c.req.param('name').toLowerCase();
  const rows = await db
    .select()
    .from(players)
    .where(eq(players.displayNameLower, nameLower))
    .orderBy(desc(players.updatedAt));

  if (rows.length === 0) {
    return c.json({ error: 'Player not found' }, 404);
  }

  if (rows.length > 1) {
    return c.json({
      ambiguous: true,
      matches: rows.map((p) => ({ id: p.id, displayName: p.displayName, updatedAt: p.updatedAt })),
    });
  }

  return c.json(await playerWithPbs(rows[0]));
});

export default playersRoute;
```

- [ ] **Step 4: Mount the route in app.ts**

Modify `backend-hono/src/app.ts` — add the import and mount line:

```typescript
import playersRoute from './routes/players';
// ...
app.route('/api/players', playersRoute);
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd backend-hono && npx vitest run test/players.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 6: Commit**

```bash
cd "osrs-pb-tracker"
git add backend-hono/src/routes/players.ts backend-hono/src/app.ts backend-hono/test/players.test.ts
git commit -m "Add GET /api/players/:name and GET /api/players/by-id/:id"
```

---

### Task 11: POST /api/sync

**Files:**
- Create: `backend-hono/src/routes/sync.ts`
- Modify: `backend-hono/src/app.ts`
- Test: `backend-hono/test/sync.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `backend-hono/test/sync.test.ts`:

```typescript
import { describe, expect, it, beforeEach } from 'vitest';
import { app } from '../src/app';
import { truncateAll } from './helpers';
import { resetRateLimiter } from '../src/lib/secret';

function syncRequest(body: unknown) {
  return app.request('/api/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/sync', () => {
  beforeEach(async () => {
    await truncateAll();
    resetRateLimiter();
  });

  it('rejects a missing accountHash', async () => {
    const res = await syncRequest({ displayName: 'Blitzen', installSecret: 'a'.repeat(20), pbs: {} });
    expect(res.status).toBe(400);
  });

  it('rejects a missing installSecret', async () => {
    const res = await syncRequest({ accountHash: '1', displayName: 'Blitzen', pbs: {} });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/installSecret/);
  });

  it('rejects an installSecret shorter than 16 characters', async () => {
    const res = await syncRequest({ accountHash: '1', displayName: 'Blitzen', installSecret: 'short', pbs: {} });
    expect(res.status).toBe(400);
  });

  it('creates a new player on first sync', async () => {
    const res = await syncRequest({
      accountHash: 'acct-1',
      displayName: 'Blitzen',
      installSecret: 'a'.repeat(20),
      pbs: { Zulrah: 80 },
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ ok: true, received: 1, updated: 1 });

    const lookup = await app.request('/api/players/Blitzen');
    expect((await lookup.json()).pbs).toEqual([
      { boss: 'zulrah', timeSeconds: 80, updatedAt: expect.any(String) },
    ]);
  });

  it('only overwrites a PB when the new time is faster', async () => {
    const secret = 'a'.repeat(20);
    await syncRequest({ accountHash: 'acct-1', displayName: 'Blitzen', installSecret: secret, pbs: { Zulrah: 80 } });
    const worse = await syncRequest({ accountHash: 'acct-1', displayName: 'Blitzen', installSecret: secret, pbs: { Zulrah: 90 } });
    expect((await worse.json()).updated).toBe(0);

    const better = await syncRequest({ accountHash: 'acct-1', displayName: 'Blitzen', installSecret: secret, pbs: { Zulrah: 75 } });
    expect((await better.json()).updated).toBe(1);
  });

  it('rejects a resync with a different secret', async () => {
    await syncRequest({ accountHash: 'acct-1', displayName: 'Blitzen', installSecret: 'a'.repeat(20), pbs: { Zulrah: 80 } });
    const res = await syncRequest({ accountHash: 'acct-1', displayName: 'Blitzen', installSecret: 'b'.repeat(20), pbs: { Zulrah: 80 } });
    expect(res.status).toBe(409);
  });

  it('rate-limits after too many requests for the same account', async () => {
    const secret = 'a'.repeat(20);
    for (let i = 0; i < 30; i += 1) {
      await syncRequest({ accountHash: 'acct-1', displayName: 'Blitzen', installSecret: secret, pbs: {} });
    }
    const res = await syncRequest({ accountHash: 'acct-1', displayName: 'Blitzen', installSecret: secret, pbs: {} });
    expect(res.status).toBe(429);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend-hono && npx vitest run test/sync.test.ts`
Expected: FAIL — 404, route doesn't exist yet.

- [ ] **Step 3: Implement the route**

Create `backend-hono/src/routes/sync.ts`:

```typescript
import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { players, personalBests } from '../db/schema';
import { hashSecret, isRateLimited } from '../lib/secret';

const sync = new Hono();

interface SyncBody {
  accountHash?: unknown;
  displayName?: unknown;
  installSecret?: unknown;
  pbs?: unknown;
}

async function upsertPlayer(accountHash: string, displayName: string, secretHash: string) {
  const nameLower = displayName.toLowerCase();
  const existingRows = await db.select().from(players).where(eq(players.accountHash, accountHash)).limit(1);
  const existing = existingRows[0];

  if (!existing) {
    const [inserted] = await db
      .insert(players)
      .values({
        accountHash,
        displayName,
        displayNameLower: nameLower,
        installSecretHash: secretHash,
        updatedAt: new Date(),
      })
      .returning();
    return { playerId: inserted.id, authorized: true };
  }

  if (!existing.installSecretHash) {
    // Row synced before install-secret enforcement existed - claim it now
    // rather than locking out data that was already synced honestly.
    await db.update(players).set({ installSecretHash: secretHash }).where(eq(players.id, existing.id));
  } else if (existing.installSecretHash !== secretHash) {
    return { playerId: existing.id, authorized: false };
  }

  if (existing.displayName !== displayName) {
    await db
      .update(players)
      .set({ displayName, displayNameLower: nameLower, updatedAt: new Date() })
      .where(eq(players.id, existing.id));
  }

  return { playerId: existing.id, authorized: true };
}

// Only overwrite a stored PB if the new time is better (lower), or there
// wasn't one before. Boss kill times only ever "improve" in this dataset.
async function upsertPb(playerId: number, boss: string, timeSeconds: number) {
  const existingRows = await db.select().from(personalBests).where(eq(personalBests.playerId, playerId));
  const existing = existingRows.find((row) => row.boss === boss);

  if (!existing) {
    await db.insert(personalBests).values({ playerId, boss, timeSeconds, updatedAt: new Date() });
    return true;
  }

  if (timeSeconds < existing.timeSeconds) {
    await db.update(personalBests).set({ timeSeconds, updatedAt: new Date() }).where(eq(personalBests.id, existing.id));
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
```

- [ ] **Step 4: Mount the route in app.ts**

Modify `backend-hono/src/app.ts` — add the import and mount line:

```typescript
import syncRoute from './routes/sync';
// ...
app.route('/api/sync', syncRoute);
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd backend-hono && npx vitest run test/sync.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 6: Run the full test suite**

Run: `cd backend-hono && npm test`
Expected: All test files pass (secret, bosses, search, leaderboard, players, sync).

- [ ] **Step 7: Commit**

```bash
cd "osrs-pb-tracker"
git add backend-hono/src/routes/sync.ts backend-hono/src/app.ts backend-hono/test/sync.test.ts
git commit -m "Add POST /api/sync with install-secret auth and rate limiting"
```

---

### Task 12: Manual end-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Start the new backend locally**

Run: `cd backend-hono && npm run dev`
Expected: `PB tracker backend (Hono) listening on http://localhost:3000`

- [ ] **Step 2: Smoke-test /api/sync with curl**

Run:
```bash
curl -X POST http://localhost:3000/api/sync \
  -H "Content-Type: application/json" \
  -d '{"accountHash":"12345","displayName":"Blitzen","installSecret":"local-smoke-test-secret","pbs":{"Nex":214,"Zulrah":118.4}}'
```
Expected: `{"ok":true,"playerId":1,"received":2,"updated":2}`

- [ ] **Step 3: Confirm the website (unchanged) works against the new backend**

Open `http://localhost:3000` in a browser, search "Blitzen". Expected: player page renders with Nex and Zulrah times, identical to how it renders against the old Express backend.

- [ ] **Step 4: Point the RuneLite plugin at the new backend**

In the running RuneLite dev client (`cd plugin && gradle run`), open the plugin's Configuration panel and set **API base URL** to `http://localhost:3000` (the new Hono backend's port — stop the old Express backend first, or run the new one on a different port temporarily, to avoid ambiguity about which backend is being hit).

- [ ] **Step 5: Trigger a real sync and confirm it round-trips**

Toggle "Sync all PBs now" in the plugin config panel. Expected: "Last synced" updates with a timestamp, no error. Then run:

```bash
curl -s http://localhost:3000/api/bosses
```
Expected: real boss names from your account appear, matching what the old backend previously showed.

- [ ] **Step 6: Confirm parity on the disambiguation and duplicate-secret paths**

Run the same collision test performed against the old backend:
```bash
curl -s -X POST http://localhost:3000/api/sync -H "Content-Type: application/json" \
  -d '{"accountHash":"other-account","displayName":"Blitzen","installSecret":"a-different-secret-string","pbs":{"Vorkath":94.2}}'
curl -s http://localhost:3000/api/players/Blitzen
```
Expected: second request succeeds (different accountHash, no conflict), and the players lookup returns `{"ambiguous":true,"matches":[...]}` with two entries.

No commit for this task — it's manual verification, not code.

---

### Task 13: Vercel deployment

**Files:**
- Create: `backend-hono/vercel.json`

- [ ] **Step 1: Write the Vercel config**

Create `backend-hono/vercel.json`:

```json
{
  "functions": {
    "api/index.ts": {
      "runtime": "nodejs20.x"
    }
  }
}
```

- [ ] **Step 2: Set the DATABASE_URL environment variable in Vercel**

In the Vercel project's dashboard (Settings → Environment Variables), add `DATABASE_URL` set to the Neon dev branch's connection string from Task 3. Apply it to the Production and Preview environments.

- [ ] **Step 3: Deploy**

Run: `cd backend-hono && vercel --prod`
Expected: Deployment succeeds, prints a production URL.

- [ ] **Step 4: Smoke-test the deployed API**

Run (substituting the real deployment URL):
```bash
curl https://<your-deployment>.vercel.app/api/bosses
```
Expected: `[]` (empty array) if nothing's been synced to production yet, or a real boss list if you've already pointed a plugin at it.

Note: the static website is **not** served from this Vercel deployment (see Task 6's `index.node.ts` comment) — it stays local/wherever it's currently hosted until the Vite frontend sub-project replaces it and gets its own deployment.

- [ ] **Step 5: Commit**

```bash
cd "osrs-pb-tracker"
git add backend-hono/vercel.json
git commit -m "Add Vercel deployment config for backend-hono"
```
