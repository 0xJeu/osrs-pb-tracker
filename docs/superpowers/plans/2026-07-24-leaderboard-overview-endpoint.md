# Leaderboard Overview Endpoint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the homepage's five separate `limit=1` leaderboard requests with one `GET /api/leaderboard-overview` endpoint backed by a single SQL query, per Workstream D of [`../specs/2026-07-24-neon-compute-wake-reduction-design.md`](../specs/2026-07-24-neon-compute-wake-reduction-design.md).

**Architecture:** A new `curatedOverviewBosses.ts` lib module holds a server-owned, hardcoded list of exact boss keys (no caller-supplied boss list, so the response shape and cache key are always the same). A new `leaderboard-overview.ts` route runs one `DISTINCT ON` query across all curated bosses, fills in `leader: null` for any curated boss with no synced PB, and applies the existing shared-cache policy with one cache tag per curated boss (present or not) so a first-ever sync for a previously-empty boss still invalidates the response.

**Tech Stack:** Hono, Drizzle ORM (`selectDistinctOn`), Vitest, the existing `backend-hono` test harness (`test/helpers.ts`, real Postgres `test` branch via `.env.test`).

---

### Task 1: Curated boss list module

**Files:**
- Create: `backend-hono/src/lib/curatedOverviewBosses.ts`
- Test: `backend-hono/test/curatedOverviewBosses.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// backend-hono/test/curatedOverviewBosses.test.ts
import { describe, expect, it } from 'vitest';
import { CURATED_OVERVIEW_BOSSES } from '../src/lib/curatedOverviewBosses.js';
import { isTrackedBoss } from '../src/lib/trackedBosses.js';

describe('CURATED_OVERVIEW_BOSSES', () => {
  it('is a non-empty, deduplicated list', () => {
    expect(CURATED_OVERVIEW_BOSSES.length).toBeGreaterThan(0);
    expect(new Set(CURATED_OVERVIEW_BOSSES).size).toBe(CURATED_OVERVIEW_BOSSES.length);
  });

  it('only contains bosses the sync route would actually accept', () => {
    for (const boss of CURATED_OVERVIEW_BOSSES) {
      expect(isTrackedBoss(boss)).toBe(true);
    }
  });

  it('only contains already-lowercased keys', () => {
    for (const boss of CURATED_OVERVIEW_BOSSES) {
      expect(boss).toBe(boss.toLowerCase());
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend-hono && npx vitest run test/curatedOverviewBosses.test.ts`
Expected: FAIL with "Cannot find module '../src/lib/curatedOverviewBosses.js'"

- [ ] **Step 3: Write minimal implementation**

```typescript
// backend-hono/src/lib/curatedOverviewBosses.ts
// Server-owned homepage "Top Bosses" card list. Deliberately hardcoded (not
// caller-supplied) so /api/leaderboard-overview always has one stable cache
// key and can't be used to force an unbounded query. Mirrors the frontend's
// TOP_BOSS_BASES curated list (frontend/src/components/PhaseTwoOsrsPreview.tsx) -
// keep them in sync manually since the frontend resolves multi-variant raids
// (Theatre of Blood, Chambers of Xeric, Tombs of Amascut) to their default
// mode's first variant, while this list uses exact synced boss keys.
export const CURATED_OVERVIEW_BOSSES = [
  'zulrah',
  'vorkath',
  'the whisperer',
  'duke sucellus',
  'the leviathan',
] as const;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend-hono && npx vitest run test/curatedOverviewBosses.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
cd backend-hono
git add src/lib/curatedOverviewBosses.ts test/curatedOverviewBosses.test.ts
git commit -m "feat: add curated boss list for leaderboard overview"
```

---

### Task 2: `GET /api/leaderboard-overview` route

**Files:**
- Create: `backend-hono/src/routes/leaderboard-overview.ts`
- Modify: `backend-hono/src/app.ts`
- Test: `backend-hono/test/leaderboard-overview.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// backend-hono/test/leaderboard-overview.test.ts
import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app.js';
import { CURATED_OVERVIEW_BOSSES } from '../src/lib/curatedOverviewBosses.js';
import { insertTestPlayerWithPb, truncateAll } from './helpers.js';

describe('GET /api/leaderboard-overview', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('returns every curated boss with a null leader when nobody has synced', async () => {
    const res = await app.request('/api/leaderboard-overview');
    expect(res.status).toBe(200);
    const json = (await res.json()) as Array<{ boss: string; leader: unknown }>;
    expect(json.map((row) => row.boss)).toEqual([...CURATED_OVERVIEW_BOSSES]);
    expect(json.every((row) => row.leader === null)).toBe(true);
  });

  it('returns the fastest synced time per curated boss and preserves list order', async () => {
    await insertTestPlayerWithPb({ boss: 'zulrah', timeSeconds: 100, displayName: 'Slow' });
    await insertTestPlayerWithPb({ boss: 'zulrah', timeSeconds: 80, displayName: 'Fast' });
    await insertTestPlayerWithPb({ boss: 'vorkath', timeSeconds: 45, displayName: 'OnlyVorkath' });

    const res = await app.request('/api/leaderboard-overview');
    const json = (await res.json()) as Array<{ boss: string; leader: { displayName: string; timeSeconds: number } | null }>;
    const zulrah = json.find((row) => row.boss === 'zulrah');
    const vorkath = json.find((row) => row.boss === 'vorkath');
    const whisperer = json.find((row) => row.boss === 'the whisperer');

    expect(zulrah?.leader).toMatchObject({ displayName: 'Fast', timeSeconds: 80 });
    expect(vorkath?.leader).toMatchObject({ displayName: 'OnlyVorkath', timeSeconds: 45 });
    expect(whisperer?.leader).toBeNull();
    expect(json.map((row) => row.boss)).toEqual([...CURATED_OVERVIEW_BOSSES]);
  });

  it('breaks a tied fastest time deterministically by display name', async () => {
    await insertTestPlayerWithPb({ boss: 'vorkath', timeSeconds: 60, displayName: 'Zed', accountHash: 'tie-1' });
    await insertTestPlayerWithPb({ boss: 'vorkath', timeSeconds: 60, displayName: 'Abe', accountHash: 'tie-2' });

    const res = await app.request('/api/leaderboard-overview');
    const json = (await res.json()) as Array<{ boss: string; leader: { displayName: string } | null }>;
    expect(json.find((row) => row.boss === 'vorkath')?.leader?.displayName).toBe('Abe');
  });

  it('ignores non-curated bosses entirely', async () => {
    await insertTestPlayerWithPb({ boss: 'nex', timeSeconds: 10, displayName: 'NexPlayer' });

    const res = await app.request('/api/leaderboard-overview');
    const json = (await res.json()) as Array<{ boss: string }>;
    expect(json.map((row) => row.boss)).not.toContain('nex');
  });

  it('sets shared-cache headers and one cache tag per curated boss', async () => {
    const res = await app.request('/api/leaderboard-overview');
    expect(res.headers.get('cache-control')).toBe('public, max-age=0, must-revalidate');
    expect(res.headers.get('cdn-cache-control')).toBe(
      'public, max-age=86400, stale-while-revalidate=604800'
    );
    const tags = res.headers.get('vercel-cache-tag')?.split(',') ?? [];
    for (const boss of CURATED_OVERVIEW_BOSSES) {
      expect(tags).toContain(`boss:${encodeURIComponent(boss)}`);
    }
  });

  it('does not accept a caller-supplied boss list', async () => {
    const res = await app.request('/api/leaderboard-overview?bosses=nex,zulrah');
    const json = (await res.json()) as Array<{ boss: string }>;
    expect(json.map((row) => row.boss)).toEqual([...CURATED_OVERVIEW_BOSSES]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend-hono && npx vitest run test/leaderboard-overview.test.ts`
Expected: FAIL (route does not exist, 404s)

- [ ] **Step 3: Write minimal implementation**

```typescript
// backend-hono/src/routes/leaderboard-overview.ts
import { asc, inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../db/client.js';
import { personalBests, players } from '../db/schema.js';
import { CURATED_OVERVIEW_BOSSES } from '../lib/curatedOverviewBosses.js';
import { bossCacheTag, cachePolicies, setSharedCache } from '../lib/cache.js';

const leaderboardOverview = new Hono();

leaderboardOverview.get('/', async (c) => {
  // DISTINCT ON (boss) with this ordering gives exactly one row per boss:
  // the fastest time, tie-broken by display name so repeated requests with
  // an identical tie are always byte-identical (cache-friendly, testable).
  const rows = await db
    .selectDistinctOn([personalBests.boss], {
      boss: personalBests.boss,
      displayName: players.displayName,
      timeSeconds: personalBests.timeSeconds,
      updatedAt: personalBests.updatedAt,
    })
    .from(personalBests)
    .innerJoin(players, (eb) => eb(players.id, personalBests.playerId))
    .where(inArray(personalBests.boss, [...CURATED_OVERVIEW_BOSSES]))
    .orderBy(asc(personalBests.boss), asc(personalBests.timeSeconds), asc(players.displayNameLower));

  const byBoss = new Map(rows.map((row) => [row.boss, row]));
  const overview = CURATED_OVERVIEW_BOSSES.map((boss) => {
    const row = byBoss.get(boss);
    return {
      boss,
      leader: row
        ? { displayName: row.displayName, timeSeconds: row.timeSeconds, updatedAt: row.updatedAt }
        : null,
    };
  });

  setSharedCache(
    c,
    cachePolicies.publicData,
    CURATED_OVERVIEW_BOSSES.map((boss) => bossCacheTag(boss))
  );
  return c.json(overview);
});

export default leaderboardOverview;
```

Note: `innerJoin`'s second argument varies by installed Drizzle version — if
`(eb) => eb(a, b)` isn't accepted, use the plain `eq(players.id, personalBests.playerId)`
form (import `eq` alongside `asc`/`inArray`), matching the style already used
in `backend-hono/src/routes/leaderboard.ts:16`.

- [ ] **Step 4: Register the route**

In `backend-hono/src/app.ts`, add the import and route registration next to the existing `leaderboardRoute`:

```typescript
import leaderboardOverviewRoute from './routes/leaderboard-overview.js';
```

```typescript
app.route('/api/leaderboard-overview', leaderboardOverviewRoute);
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend-hono && npx vitest run test/leaderboard-overview.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 6: Run the full backend suite and typecheck**

Run: `cd backend-hono && npm run typecheck && npm test`
Expected: all pass, no regressions in `leaderboard.test.ts` or `cache.test.ts`

- [ ] **Step 7: Commit**

```bash
cd backend-hono
git add src/routes/leaderboard-overview.ts src/app.ts test/leaderboard-overview.test.ts
git commit -m "feat: add GET /api/leaderboard-overview endpoint"
```

---

### Task 3: Point the frontend at the new endpoint (coordination note)

This plan intentionally stops at the backend. The frontend's five-request
`Promise.all` loop over `api.getLeaderboard(entry.key, 1)`
(`frontend/src/components/PhaseTwoOsrsPreview.tsx:170-190`) is replaced as
part of the separate frontend plan
(`docs/superpowers/plans/2026-07-24-frontend-view-scoped-fetching.md`), which
depends on this endpoint existing. Per the spec's rollout order: **deploy
this backend endpoint before merging the frontend change that calls it**, or
keep the frontend's existing per-boss fallback active until this is
confirmed live in production.

---

## Self-Review Notes

- **Spec coverage:** one SQL statement (✓ Task 2), at most one row per
  configured boss (✓ DISTINCT ON), exact boss cache tags for every included
  boss including absent ones (✓ Task 2 Step 5 test + implementation), public
  shared-cache policy (✓), no arbitrary caller-supplied boss list (✓ Task 2
  final test), invalidates through boss tag on a PB change (inherited for
  free — reuses the existing `bossCacheTag` invalidation already fired by
  `sync.ts` on every accepted PB; no new invalidation code needed since this
  route doesn't introduce a new cache *tag namespace*, just a new response
  that depends on existing ones).
- **No placeholders:** all steps contain complete code.
- **Type consistency:** `CURATED_OVERVIEW_BOSSES` is `as const` in Task 1 and
  spread (`[...CURATED_OVERVIEW_BOSSES]`) everywhere it's passed to a
  Drizzle `inArray`/array context in Task 2, matching.
