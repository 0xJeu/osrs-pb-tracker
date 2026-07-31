# Frontend View-Scoped Fetching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make each website view request only the data it renders, replace the five-request "Top Bosses" fan-out with the new `/api/leaderboard-overview` endpoint, and add canonical request keys / short client caching / universal-search controls — Workstreams C, E, and H of [`../specs/2026-07-24-neon-compute-wake-reduction-design.md`](../specs/2026-07-24-neon-compute-wake-reduction-design.md).

**Architecture:** `src/lib/api.ts` grows a small request layer (canonical query-string building, in-flight GET coalescing, a bounded session cache with per-endpoint TTLs) that every existing method routes through. `src/components/PhaseTwoOsrsPreview.tsx`'s single mount-wide `useEffect` (currently fetching stats/recent-syncs/bosses/top-bosses/leaderboard regardless of which view is showing) is split into effects keyed on `view.name`, using an `'idle'` load state so data already fetched isn't refetched on return-to-home navigation.

**Tech Stack:** React 18, Vite, Vitest, `@testing-library/react` + `jsdom` (added in Task 1 — not currently installed), the existing `frontend/src/lib/api.ts` client.

**Depends on:** `docs/superpowers/plans/2026-07-24-leaderboard-overview-endpoint.md` must be deployed to the backend before Task 3 of this plan ships, per the spec's rollout note. Tasks 1-2 and 4-5 have no such dependency and can land first.

---

### Task 1: Component-test infrastructure

**Files:**
- Modify: `frontend/package.json`
- Modify: `frontend/vite.config.ts`
- Create: `frontend/test/setup.ts`
- Test: `frontend/test/smoke.test.tsx`

No component-rendering test exists yet (`frontend/test/*.test.ts` only tests pure functions). The spec requires asserting request counts per route, which needs a mounted `<PhaseTwoOsrsPreview />` and a DOM.

- [ ] **Step 1: Install test dependencies**

Run: `cd frontend && npm install --save-dev @testing-library/react@^16.0.0 @testing-library/jest-dom@^6.5.0 jsdom@^25.0.0`
Expected: `package.json` devDependencies gain the three packages.

- [ ] **Step 2: Configure jsdom environment and setup file**

```typescript
// frontend/vite.config.ts
/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    exclude: ['e2e/**', 'node_modules/**'],
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
  },
});
```

```typescript
// frontend/test/setup.ts
import '@testing-library/jest-dom/vitest';
```

- [ ] **Step 3: Write the failing smoke test**

```tsx
// frontend/test/smoke.test.tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

describe('component test infrastructure', () => {
  it('can render a DOM node and query it', () => {
    render(<div>hello</div>);
    expect(screen.getByText('hello')).toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Run test to verify it fails, then passes**

Run: `cd frontend && npx vitest run test/smoke.test.tsx`
Expected: fails before Steps 1-2 are done (missing packages / `document is not defined`), passes after.

- [ ] **Step 5: Commit**

```bash
cd frontend
git add package.json package-lock.json vite.config.ts test/setup.ts test/smoke.test.tsx
git commit -m "test: add jsdom + Testing Library for component tests"
```

---

### Task 2: Canonical request keys, in-flight coalescing, and session cache in `api.ts`

**Files:**
- Modify: `frontend/src/lib/api.ts`
- Test: `frontend/test/api.test.ts` (extend existing file)

- [ ] **Step 1: Write the failing tests**

Add to the bottom of `frontend/test/api.test.ts`:

```typescript
describe('request coalescing and session caching', () => {
  it('coalesces two identical in-flight GETs into one fetch call', async () => {
    let resolveFetch: (res: Response) => void;
    const fetchFn = vi.fn().mockImplementation(
      () => new Promise<Response>((resolve) => { resolveFetch = resolve; })
    );
    const api = createApiClient('', fetchFn);

    const first = api.getStats();
    const second = api.getStats();
    resolveFetch!(jsonResponse({ trackedPlayers: 1, personalBestRecords: 2 }));

    await Promise.all([first, second]);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('serves a repeated boss-list request from the session cache without refetching', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(['zulrah']));
    const api = createApiClient('', fetchFn);

    await api.getBosses();
    await api.getBosses();
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('does not cache a rejected request, so a retry can succeed', async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(new Response('err', { status: 500 }))
      .mockResolvedValueOnce(jsonResponse({ trackedPlayers: 1, personalBestRecords: 2 }));
    const api = createApiClient('', fetchFn);

    await expect(api.getStats()).rejects.toThrow();
    await expect(api.getStats()).resolves.toEqual({ trackedPlayers: 1, personalBestRecords: 2 });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('builds a canonical leaderboard-page URL: trimmed/lowercased boss, clamped limit/offset, ordered params', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ rows: [], total: 0, limit: 50, offset: 0 }));
    const api = createApiClient('', fetchFn);

    await api.getLeaderboardPage('  Zulrah  ', 500, -5, '  Blitzen  ');
    expect(fetchFn).toHaveBeenCalledWith('/api/leaderboard/zulrah?limit=100&offset=0&highlight=blitzen');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run test/api.test.ts`
Expected: FAIL — no coalescing/caching exists yet, and `getLeaderboardPage` doesn't clamp/canonicalize offset or lowercase highlight (current code at `frontend/src/lib/api.ts:150-156` passes `boss` and `highlight` through un-normalized and doesn't clamp `limit`/`offset`).

- [ ] **Step 3: Implement the request layer**

Replace the top of `createApiClient` in `frontend/src/lib/api.ts` (the `getJson` function and the `searchCache` line) with:

```typescript
export function createApiClient(baseUrl: string, fetchFn: typeof fetch = fetch) {
  const base = baseUrl.replace(/\/+$/, '');

  const inFlight = new Map<string, Promise<unknown>>();
  const sessionCache = new Map<string, { expiresAt: number; value: unknown }>();

  function now() {
    return Date.now();
  }

  async function getJson<T>(path: string, ttlMs = 0): Promise<T> {
    const cached = sessionCache.get(path);
    if (cached && cached.expiresAt > now()) {
      return cached.value as T;
    }

    const pending = inFlight.get(path);
    if (pending) {
      return pending as Promise<T>;
    }

    const request = (async () => {
      const res = await fetchFn(`${base}${path}`);
      if (!res.ok) {
        throw new ApiError(res.status);
      }
      const value = (await res.json()) as T;
      if (ttlMs > 0) {
        sessionCache.set(path, { expiresAt: now() + ttlMs, value });
      }
      return value;
    })();

    inFlight.set(path, request);
    try {
      return await request;
    } finally {
      inFlight.delete(path);
    }
  }

  function invalidate(path: string) {
    sessionCache.delete(path);
  }

  // Endpoint-specific session TTLs from the compute-wake design (Workstream E).
  const TTL = {
    playerProfile: 5 * 60 * 1000,
    bossList: Number.POSITIVE_INFINITY, // session lifetime
    statsRecentOverview: 2 * 60 * 1000,
    search: 5 * 60 * 1000,
  } as const;
```

Then update the existing methods to pass a TTL and use canonical query building. Replace `getBosses`, `getLeaderboardPage`, `getRecentSyncs`, and `getStats`:

```typescript
    async getBosses(): Promise<string[]> {
      const bosses = await getJson<string[]>('/api/bosses', TTL.bossList);
      return bosses.filter(isTrackedBoss);
    },
    getLeaderboard(boss: string, limit = 25, highlight?: string): Promise<LeaderboardRow[]> {
      const canonicalBoss = boss.trim().toLowerCase();
      const canonicalLimit = Math.min(Math.max(Math.floor(limit) || 25, 1), 100);
      const canonicalHighlight = highlight?.trim().toLowerCase();
      const highlightParam = canonicalHighlight
        ? `&highlight=${encodeURIComponent(canonicalHighlight)}`
        : '';
      return getJson(
        `/api/leaderboard/${encodeURIComponent(canonicalBoss)}?limit=${canonicalLimit}${highlightParam}`
      );
    },
    async getLeaderboardPage(boss: string, limit = 50, offset = 0, highlight?: string): Promise<LeaderboardPage> {
      const canonicalBoss = boss.trim().toLowerCase();
      const canonicalLimit = Math.min(Math.max(Math.floor(limit) || 50, 1), 100);
      const canonicalOffset = Math.max(Math.floor(offset) || 0, 0);
      const canonicalHighlight = highlight?.trim().toLowerCase();
      const highlightParam = canonicalHighlight ? `&highlight=${encodeURIComponent(canonicalHighlight)}` : '';
      const path = `/api/leaderboard/${encodeURIComponent(canonicalBoss)}?limit=${canonicalLimit}&offset=${canonicalOffset}${highlightParam}`;
      const data = await getJson<LeaderboardPage | LeaderboardRow[]>(path);
      if (Array.isArray(data)) return { rows: data, total: data.length, limit: canonicalLimit, offset: 0 };
      return data;
    },
    getRecentSyncs(limit = 10): Promise<RecentSync[]> {
      const canonicalLimit = Math.min(Math.max(Math.floor(limit) || 10, 1), 25);
      return getJson(`/api/recent-syncs?limit=${canonicalLimit}`, TTL.statsRecentOverview);
    },
    getStats(): Promise<QuickStats> {
      return getJson('/api/stats', TTL.statsRecentOverview);
    },
    getLeaderboardOverview(): Promise<Array<{ boss: string; leader: LeaderboardRow | null }>> {
      return getJson('/api/leaderboard-overview', TTL.statsRecentOverview);
    },
    invalidatePlayerProfile(name: string) {
      invalidate(`/api/players/${encodeURIComponent(name.trim().toLowerCase())}`);
    },
```

Note: `lookupPlayer` should also route through `getJson`'s caching with `TTL.playerProfile` —
change its body from a raw `fetchFn` call to:
```typescript
    async lookupPlayer(name: string): Promise<PlayerLookup> {
      const canonicalName = name.trim().toLowerCase();
      const cached = sessionCache.get(`/api/players/${encodeURIComponent(canonicalName)}`);
      if (cached && cached.expiresAt > now()) {
        return playerFrom(new Response(JSON.stringify(cached.value), { status: 200 }));
      }
      const path = `/api/players/${encodeURIComponent(canonicalName)}`;
      const res = await fetchFn(`${base}${path}`);
      if (res.ok) {
        const cloned = res.clone();
        void cloned.json().then((value) => sessionCache.set(path, { expiresAt: now() + TTL.playerProfile, value }));
      }
      return playerFrom(res);
    },
```

Leave `search`'s existing in-flight `searchCache` map as-is (it already
dedupes and is superseded by the unified `search()`/`searchAll()` rewrite in
Task 4) — don't merge it into `inFlight` in this step to keep this diff
reviewable.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run test/api.test.ts`
Expected: PASS (all existing + 4 new tests)

- [ ] **Step 5: Run full frontend suite**

Run: `cd frontend && npm test`
Expected: no regressions

- [ ] **Step 6: Commit**

```bash
cd frontend
git add src/lib/api.ts test/api.test.ts
git commit -m "feat: add canonical request keys, in-flight coalescing, session cache to api client"
```

---

### Task 3: View-scoped fetch effects in `PhaseTwoOsrsPreview.tsx`

**Files:**
- Modify: `frontend/src/components/PhaseTwoOsrsPreview.tsx`

Current behavior being replaced:
- `frontend/src/components/PhaseTwoOsrsPreview.tsx:155-165` — one mount-only effect fetches bosses, stats, and recent-syncs unconditionally, on every route including FAQ/Setup.
- `frontend/src/components/PhaseTwoOsrsPreview.tsx:170-190` — a second effect fires 5 separate `api.getLeaderboard(entry.key, 1)` calls once bosses load, regardless of view.
- `frontend/src/components/PhaseTwoOsrsPreview.tsx:205-213` — the leaderboard-page effect depends only on `[selectedBoss, highlight, leaderboardOffset]`, not on `view.name`. Since `selectedBoss` gets a non-empty default the moment bosses load (line 160), this effect fires a hidden `/api/leaderboard/...` request even when the user is on the FAQ, Setup, or Player page.

- [ ] **Step 1: Add an `'idle'` load state and switch initial states**

```typescript
// frontend/src/components/PhaseTwoOsrsPreview.tsx:19
type LoadState<T> = { s: 'idle' } | { s: 'loading' } | { s: 'error' } | { s: 'loaded'; data: T };
```

```typescript
// frontend/src/components/PhaseTwoOsrsPreview.tsx:138-143
  const [bosses, setBosses] = useState<LoadState<string[]>>({ s: 'idle' });
  const [stats, setStats] = useState<LoadState<QuickStats>>({ s: 'idle' });
  const [recentSyncs, setRecentSyncs] = useState<LoadState<RecentSync[]>>({ s: 'idle' });
  const [leaderboard, setLeaderboard] = useState<LoadState<LeaderboardPage>>({ s: 'idle' });
  const [leaderboardOffset, setLeaderboardOffset] = useState(0);
  const [topBosses, setTopBosses] = useState<LoadState<Array<{ boss: string; leader: LeaderboardRow | null }>>>({ s: 'idle' });
```

Every render path that checks `bosses.s === 'loading'` / `'error'` for a
"Loading bosses..." message (`BossView`, around line 587) already falls
through correctly for `'idle'` — but update its condition explicitly so idle
doesn't render as an error:

```typescript
// frontend/src/components/PhaseTwoOsrsPreview.tsx:587
          <div className="pbt-panel-state">{bosses.s === 'error' ? 'Boss list unavailable.' : 'Loading bosses...'}</div>
```
(unchanged text is fine — `'idle'` and `'loading'` both show "Loading
bosses..." until the view-scoped effect below kicks off the fetch, which
happens synchronously on the first render of that view.)

- [ ] **Step 2: Replace the mount-wide effect with view-scoped effects**

Replace lines 155-190 (`frontend/src/components/PhaseTwoOsrsPreview.tsx`) with:

```typescript
  // Boss list: needed on home (for Top Bosses key resolution) and boss
  // views. Other views may still get boss suggestions from universal search
  // without preloading the full list.
  useEffect(() => {
    if ((view.name !== 'home' && view.name !== 'boss') || bosses.s !== 'idle') return;
    let alive = true;
    setBosses({ s: 'loading' });
    api.getBosses().then((data) => {
      if (!alive) return;
      setBosses({ s: 'loaded', data });
      setSelectedBoss((current) => current || pickInitialBoss(data));
    }).catch(() => alive && setBosses({ s: 'error' }));
    return () => { alive = false; };
  }, [view.name, bosses.s]);

  useEffect(() => {
    if (view.name !== 'home' || stats.s !== 'idle') return;
    let alive = true;
    setStats({ s: 'loading' });
    api.getStats().then((data) => alive && setStats({ s: 'loaded', data })).catch(() => alive && setStats({ s: 'error' }));
    return () => { alive = false; };
  }, [view.name, stats.s]);

  useEffect(() => {
    if (view.name !== 'home' || recentSyncs.s !== 'idle') return;
    let alive = true;
    setRecentSyncs({ s: 'loading' });
    api.getRecentSyncs(6).then((data) => alive && setRecentSyncs({ s: 'loaded', data })).catch(() => alive && setRecentSyncs({ s: 'error' }));
    return () => { alive = false; };
  }, [view.name, recentSyncs.s]);

  // One request replaces the previous 5-request per-boss fan-out (Workstream D).
  useEffect(() => {
    if (view.name !== 'home' || topBosses.s !== 'idle') return;
    let alive = true;
    setTopBosses({ s: 'loading' });
    api.getLeaderboardOverview()
      .then((data) => alive && setTopBosses({ s: 'loaded', data }))
      .catch(() => alive && setTopBosses({ s: 'error' }));
    return () => { alive = false; };
  }, [view.name, topBosses.s]);
```

- [ ] **Step 3: Guard the leaderboard-page effect to the boss view only**

```typescript
// frontend/src/components/PhaseTwoOsrsPreview.tsx:205-213 (was)
  useEffect(() => {
    if (!selectedBoss) return;
    let alive = true;
    setLeaderboard({ s: 'loading' });
    api.getLeaderboardPage(selectedBoss, LEADERBOARD_PAGE_SIZE, leaderboardOffset, highlight)
      .then((data) => alive && setLeaderboard({ s: 'loaded', data }))
      .catch(() => alive && setLeaderboard({ s: 'error' }));
    return () => { alive = false; };
  }, [selectedBoss, highlight, leaderboardOffset]);
```

becomes:

```typescript
  useEffect(() => {
    if (view.name !== 'boss' || !selectedBoss) return;
    let alive = true;
    setLeaderboard({ s: 'loading' });
    api.getLeaderboardPage(selectedBoss, LEADERBOARD_PAGE_SIZE, leaderboardOffset, highlight)
      .then((data) => alive && setLeaderboard({ s: 'loaded', data }))
      .catch(() => alive && setLeaderboard({ s: 'error' }));
    return () => { alive = false; };
  }, [view.name, selectedBoss, highlight, leaderboardOffset]);
```

- [ ] **Step 4: Update `HomeView`'s `topBosses` prop type and rendering**

`HomeView`'s prop type (`frontend/src/components/PhaseTwoOsrsPreview.tsx:389`)
and the "Top bosses" card block (lines 448-466) currently expect
`{ base, label, key, row? }`. Update both to the new overview shape:

```typescript
  topBosses: LoadState<Array<{ boss: string; leader: LeaderboardRow | null }>>;
```

```tsx
        {isLoaded(topBosses) && (
          <div className="pbt-cards">
            {topBosses.data.map((entry, index) => (
              <button type="button" className="pbt-card" key={entry.boss} onClick={() => goToBoss(entry.boss)}>
                <span className="idx">{String(index + 1).padStart(2, '0')}</span>
                <PetIcon boss={entry.boss} size="lg" />
                <div className="bname">{bossTitleParts(entry.boss).primary}</div>
                {entry.leader ? (
                  <>
                    <div className="btime">{formatTime(entry.leader.timeSeconds)}</div>
                    <div className="brank">{entry.leader.displayName}</div>
                  </>
                ) : (
                  <div className="brank">No synced time yet</div>
                )}
              </button>
            ))}
          </div>
        )}
```

This removes the need for `TOP_BOSS_BASES`, `resolveBossKey`, and the
`topBosses` boss-resolution effect entirely — the curated list now lives
server-side (`CURATED_OVERVIEW_BOSSES` in the backend plan). Delete the now-
unused `TOP_BOSS_BASES` constant (line 51) and `resolveBossKey` function
(lines 101-107) if nothing else in the file references them (verify with
`grep -n resolveBossKey frontend/src/components/PhaseTwoOsrsPreview.tsx`
before deleting — `compactAliasSuggestions` doesn't use it, but confirm).

- [ ] **Step 5: Preserve loaded state across client-side navigation**

This falls out of Steps 2-3 for free: state lives in the top-level component
(not remounted per view), and each effect's guard (`bosses.s !== 'idle'`,
etc.) means returning to the home view after visiting another view does not
refetch — the loaded data is still there. No additional code needed; this
is verified by the test in Task 5 Step 1's third test case.

- [ ] **Step 6: Typecheck and build**

Run: `cd frontend && npm run build`
Expected: no TypeScript errors

- [ ] **Step 7: Commit**

```bash
cd frontend
git add src/components/PhaseTwoOsrsPreview.tsx
git commit -m "feat: scope data fetching to the active view"
```

---

### Task 4: Universal search controls (Workstream H)

**Files:**
- Modify: `frontend/src/lib/api.ts`
- Modify: `frontend/src/components/PhaseTwoOsrsPreview.tsx`
- Test: `frontend/test/api.test.ts` (extend)

Current gaps in `frontend/src/lib/api.ts:105-121` (`search`) and `:123-136`
(`searchAll`): `searchAll` has no minimum-length guard (only `search` does),
neither has an `AbortController`, and `searchAll` isn't cached at all. The
debounce in `PhaseTwoOsrsPreview.tsx:215-227` is 200ms (spec recommends
250-300ms) and has no request-generation guard, so a slow response to an
earlier keystroke can overwrite a newer one's results — `.then(setSuggestions)`
runs unconditionally even after `playerQuery` has changed again.

- [ ] **Step 1: Write the failing test**

Add to `frontend/test/api.test.ts`:

```typescript
describe('searchAll request controls', () => {
  it('rejects queries under two characters without calling fetch', async () => {
    const fetchFn = vi.fn();
    const api = createApiClient('', fetchFn);
    expect(await api.searchAll('a')).toEqual([]);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('caches a successful searchAll result for repeated identical queries', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse([{ type: 'player', value: 'blitzen' }]));
    const api = createApiClient('', fetchFn);
    await api.searchAll('blitzen');
    await api.searchAll('blitzen');
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('canonicalizes the query before building the URL', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse([]));
    const api = createApiClient('', fetchFn);
    await api.searchAll('  Blitzen  ');
    expect(fetchFn).toHaveBeenCalledWith('/api/search/all?q=blitzen');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run test/api.test.ts`
Expected: FAIL (no min-length guard, no cache, no canonicalization for `searchAll`)

- [ ] **Step 3: Implement**

Replace `searchAll` in `frontend/src/lib/api.ts:123-136`:

```typescript
    async searchAll(q: string): Promise<SearchSuggestion[]> {
      const canonicalQuery = q.trim().toLowerCase();
      if (canonicalQuery.length < 2) {
        return [];
      }
      try {
        return await getJson(`/api/search/all?q=${encodeURIComponent(canonicalQuery)}`, TTL.search);
      } catch {
        // Rolling-deploy fallback: keep the makeover usable while the
        // currently deployed backend still exposes only the legacy routes.
        const [playerNames, bosses] = await Promise.all([
          getJson<string[]>(`/api/search?q=${encodeURIComponent(canonicalQuery)}`).catch(() => []),
          getJson<string[]>('/api/bosses', TTL.bossList).catch(() => []),
        ]);
        return [
          ...playerNames.map((value) => ({ type: 'player' as const, value })),
          ...bosses
            .filter((value) => matchesBossSearch(value, canonicalQuery))
            .map((value) => ({ type: 'boss' as const, value })),
        ];
      }
    },
```

`getJson`'s session cache (from Task 2) is a plain `Map` with no eviction —
fine for `bossList`/profile/stats given the endpoint counts involved, but
the spec requires a *bounded* LRU specifically for search (unbounded search
query strings could grow unboundedly over a long session). Add eviction only
to the search TTL path: change `sessionCache` in Task 2's `getJson` to evict
the oldest entry past 200 keys before inserting when `ttlMs === TTL.search`:

```typescript
    if (ttlMs > 0) {
      if (ttlMs === TTL.search && sessionCache.size >= 200) {
        const oldestKey = sessionCache.keys().next().value;
        if (oldestKey) sessionCache.delete(oldestKey);
      }
      sessionCache.set(path, { expiresAt: now() + ttlMs, value });
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run test/api.test.ts`
Expected: PASS

- [ ] **Step 5: Fix the stale-response race and lengthen the debounce in the component**

Replace the suggestions effect at `frontend/src/components/PhaseTwoOsrsPreview.tsx:215-227`:

```typescript
  useEffect(() => {
    const query = playerQuery.trim();
    if (query.length < 2) { setSuggestions([]); return; }
    const compactSuggestions = isLoaded(bosses) ? compactAliasSuggestions(query, bosses.data) : undefined;
    if (compactSuggestions) {
      setSuggestions(compactSuggestions);
      return;
    }
    let alive = true;
    const timer = window.setTimeout(() => {
      api.searchAll(query).then((result) => { if (alive) setSuggestions(result); }).catch(() => { if (alive) setSuggestions([]); });
    }, 275);
    return () => { alive = false; window.clearTimeout(timer); };
  }, [playerQuery, bosses]);
```

The `alive` flag is the abort mechanism here: it's set to `false` in the
cleanup function, which React runs before starting the next effect
invocation (i.e. on every keystroke), so a still-in-flight response from an
older query can never call `setSuggestions` after a newer one has started —
satisfying "a late response cannot replace results for newer input" without
needing `AbortController` plumbed through `api.searchAll`'s cached-promise
path (an aborted fetch would poison the shared cache entry for other
callers).

- [ ] **Step 6: Run full frontend suite**

Run: `cd frontend && npm test`
Expected: no regressions

- [ ] **Step 7: Commit**

```bash
cd frontend
git add src/lib/api.ts src/components/PhaseTwoOsrsPreview.tsx test/api.test.ts
git commit -m "feat: add universal search request controls"
```

---

### Task 5: Request-budget tests per route

**Files:**
- Create: `frontend/test/requestBudget.test.tsx`

- [ ] **Step 1: Write the tests**

```tsx
// frontend/test/requestBudget.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { PhaseTwoOsrsPreview } from '../src/components/PhaseTwoOsrsPreview';

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

function mockFetch() {
  return vi.fn().mockImplementation((url: string) => {
    if (url.includes('/api/bosses')) return Promise.resolve(jsonResponse(['zulrah', 'vorkath']));
    if (url.includes('/api/stats')) return Promise.resolve(jsonResponse({ trackedPlayers: 1, personalBestRecords: 1 }));
    if (url.includes('/api/recent-syncs')) return Promise.resolve(jsonResponse([]));
    if (url.includes('/api/leaderboard-overview')) return Promise.resolve(jsonResponse([]));
    if (url.includes('/api/leaderboard/')) return Promise.resolve(jsonResponse({ rows: [], total: 0, limit: 50, offset: 0 }));
    if (url.includes('/api/players/')) return Promise.resolve(jsonResponse({ error: 'not found' }, { status: 404 } as never));
    return Promise.resolve(jsonResponse([]));
  });
}

function setPath(path: string) {
  window.history.pushState({}, '', path);
}

describe('per-view request budget', () => {
  let fetchSpy: ReturnType<typeof mockFetch>;

  beforeEach(() => {
    fetchSpy = mockFetch();
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('home view requests bosses, stats, recent-syncs, and one overview call — no per-boss leaderboard fan-out', async () => {
    setPath('/');
    render(<PhaseTwoOsrsPreview />);
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith(expect.stringContaining('/api/leaderboard-overview')));

    const paths = fetchSpy.mock.calls.map(([url]) => String(url));
    expect(paths.some((p) => p.includes('/api/bosses'))).toBe(true);
    expect(paths.some((p) => p.includes('/api/stats'))).toBe(true);
    expect(paths.some((p) => p.includes('/api/recent-syncs'))).toBe(true);
    expect(paths.filter((p) => p.includes('/api/leaderboard-overview'))).toHaveLength(1);
    expect(paths.some((p) => p.includes('/api/leaderboard/'))).toBe(false);
  });

  it('player view requests only the player profile', async () => {
    setPath('/player/blitzen');
    render(<PhaseTwoOsrsPreview />);
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith(expect.stringContaining('/api/players/blitzen')));

    const paths = fetchSpy.mock.calls.map(([url]) => String(url));
    expect(paths).toHaveLength(1);
  });

  it('boss view requests bosses and one leaderboard page, no home data', async () => {
    setPath('/boss/zulrah');
    render(<PhaseTwoOsrsPreview />);
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith(expect.stringContaining('/api/leaderboard/zulrah')));

    const paths = fetchSpy.mock.calls.map(([url]) => String(url));
    expect(paths.some((p) => p.includes('/api/bosses'))).toBe(true);
    expect(paths.some((p) => p.includes('/api/leaderboard/zulrah'))).toBe(true);
    expect(paths.some((p) => p.includes('/api/stats'))).toBe(false);
    expect(paths.some((p) => p.includes('/api/recent-syncs'))).toBe(false);
    expect(paths.some((p) => p.includes('/api/leaderboard-overview'))).toBe(false);
  });

  it('FAQ and Setup views make zero initial API requests', async () => {
    setPath('/faq');
    render(<PhaseTwoOsrsPreview />);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify current behavior (should FAIL before Task 3)**

Run: `cd frontend && npx vitest run test/requestBudget.test.tsx`
Expected (if run before Task 3 lands): FAIL — home view currently over-fetches
5 leaderboard requests, boss view fetches stats/recent-syncs it shouldn't, and
FAQ/Setup views fetch bosses/stats/recent-syncs unconditionally.

- [ ] **Step 3: Confirm passing after Task 3 and Task 4 are applied**

Run: `cd frontend && npx vitest run test/requestBudget.test.tsx`
Expected: PASS (4 tests)

- [ ] **Step 4: Run full suite and build**

Run: `cd frontend && npm test && npm run build`
Expected: all pass, clean build

- [ ] **Step 5: Commit**

```bash
cd frontend
git add test/requestBudget.test.tsx
git commit -m "test: assert per-view request budgets"
```

---

## Self-Review Notes

- **Spec coverage:** home/player/boss/FAQ/setup budgets (✓ Task 5), no
  hidden default-boss leaderboard request (✓ Task 3 Step 3), one overview
  request replacing 5 (✓ Task 3 Steps 2 & 4), preserve loaded state on
  return-to-home (✓ Task 3 Step 5), canonical URLs (✓ Task 2 Step 3, Task 4
  Step 3), in-flight/session caching with the spec's per-endpoint TTLs (✓
  Task 2), rejected promises not cached (✓ Task 2 Step 1 third test), search
  min-length/debounce/cache/no-stale-overwrite (✓ Task 4). Browser
  `Cache-Control: max-age=120` header change is a **backend** response-header
  change (`backend-hono/src/lib/cache.ts`'s `setSharedCache`), out of scope
  for this frontend-only plan — flagged as a gap for the Phase 2 backend plan.
- **No placeholders:** all steps contain complete code.
- **Type consistency:** `LoadState<T>` gains `'idle'` in Task 3 Step 1 and
  every existing `LoadState` consumer (`isLoaded`, the `'loading'`/`'error'`
  render branches) already handles unlisted variants as falling through to
  their default branch, so no other type signature changes are needed;
  `topBosses`'s element type changes from `{ base, label, key, row? }` to
  `{ boss, leader }` consistently across its `useState` type (Task 3 Step 1),
  its effect (Step 2), and `HomeView`'s prop type + JSX (Step 4).
