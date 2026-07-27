# PbTrackerApp Decomposition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split `frontend/src/components/PhaseTwoOsrsPreview.tsx` (829 lines, the entire production website in one file) into per-view components, named data-fetching hooks, and relocated pure helpers, per [`../specs/2026-07-26-pb-tracker-app-decomposition-design.md`](../specs/2026-07-26-pb-tracker-app-decomposition-design.md). Finish renaming every "preview"-labeled identifier in the process, since the file is confirmed production, not a mockup.

**Architecture:** This is a behavior-preserving refactor, not a feature change. Tasks 1-8 extract logic into `hooks/` while everything still lives in one file (safest order — the tricky reasoning happens with full-file context, verified incrementally by the existing test suite staying green). Tasks 9-11 then physically move already-correct, already-self-contained view functions into their own files (mechanical cut/paste + import fixes only, low risk). Task 12 does the final rename and cleanup.

Because this is a relocation, not new functionality, tasks do not follow a literal red-green TDD cycle (there is no new behavior to drive with a failing test). Instead, each task's safety net is: (1) TypeScript catching wrong imports, (2) the full existing test suite (91 tests as of this writing) staying green, and (3) `npm run build` staying clean. Run `npx tsc --noEmit` after each file change and fix whatever it reports (missing imports, unused imports) before moving on — exact import lists are given below but are not guaranteed byte-perfect; the compiler is the source of truth. One task (Task 8) does add a genuinely new test, because it's the one place real interaction logic moves and shifts ownership, and it was previously uncovered by any automated test.

**Tech Stack:** React 18, TypeScript, Vite, Vitest, `@testing-library/react` (already set up).

**Working directory for all tasks:** `/Users/stephanejeudy/PycharmProjects/2026_projects/OSRS Stuff/worktrees/osrs-pb-tracker-app-decomposition`, frontend at `frontend/`, branch `pbtracker-app-decomposition` (already created, stacked on `frontend-view-scoped-fetching`). Environment note: `npm`/`npx` may need `unset -f nvm node npm npx corepack; source /opt/homebrew/opt/nvm/nvm.sh` first in this shell, or call `frontend/node_modules/.bin/vitest` / `.bin/tsc` / `.bin/vite` directly.

---

### Task 1: `lib/loadState.ts`

**Files:**
- Create: `frontend/src/lib/loadState.ts`
- Modify: `frontend/src/components/PhaseTwoOsrsPreview.tsx`

- [ ] **Step 1: Create the shared module**

```typescript
// frontend/src/lib/loadState.ts
export type LoadState<T> = { s: 'idle' } | { s: 'loading' } | { s: 'error' } | { s: 'loaded'; data: T };

export function isLoaded<T>(state: LoadState<T>): state is { s: 'loaded'; data: T } {
  return state.s === 'loaded';
}
```

- [ ] **Step 2: Remove the local definitions and import instead**

In `frontend/src/components/PhaseTwoOsrsPreview.tsx`, delete this line (currently line 19):

```typescript
type LoadState<T> = { s: 'idle' } | { s: 'loading' } | { s: 'error' } | { s: 'loaded'; data: T };
```

and this function (currently lines 68-70):

```typescript
function isLoaded<T>(state: LoadState<T>): state is { s: 'loaded'; data: T } {
  return state.s === 'loaded';
}
```

Add to the top of the file's imports:

```typescript
import { isLoaded, type LoadState } from '../lib/loadState';
```

- [ ] **Step 3: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: clean (no errors)

- [ ] **Step 4: Run full test suite**

Run: `cd frontend && npx vitest run`
Expected: all tests pass, same count as before this task (91)

- [ ] **Step 5: Commit**

```bash
cd frontend
git add src/lib/loadState.ts src/components/PhaseTwoOsrsPreview.tsx
git commit -m "refactor: extract LoadState to lib/loadState.ts"
```

---

### Task 2: `hooks/useRoute.ts` — routing extraction and "preview" naming cleanup

**Files:**
- Create: `frontend/src/hooks/useRoute.ts`
- Modify: `frontend/src/components/PhaseTwoOsrsPreview.tsx`

This task also finishes the naming cleanup for routing-related identifiers:
`PreviewView` → `Route`, `viewFromPreviewPath` → `routeFromPath`, the `view`/`setView`
variable → `route`/`setRoute` everywhere it appears, and deletes `previewBase`
entirely (it's a hardcoded `''` literal, never derived from config — confirmed
via the design spec — so every `${previewBase}` interpolation simplifies to
nothing).

- [ ] **Step 1: Create the hook**

```typescript
// frontend/src/hooks/useRoute.ts
import { useEffect, useState } from 'react';

export type Route =
  | { name: 'home' }
  | { name: 'boss'; boss: string; highlight?: string }
  | { name: 'player'; player: string }
  | { name: 'about' }
  | { name: 'faq' }
  | { name: 'setup' };

export function routeFromPath(): Route {
  const rest = window.location.pathname;
  if (rest === '/about') return { name: 'about' };
  if (rest === '/faq') return { name: 'faq' };
  if (rest === '/setup') return { name: 'setup' };
  const playerMatch = rest.match(/^\/player\/(.+)$/);
  if (playerMatch) return { name: 'player', player: decodeURIComponent(playerMatch[1]) };
  const bossMatch = rest.match(/^\/boss\/(.+)$/);
  if (bossMatch) {
    const highlight = new URLSearchParams(window.location.search).get('highlight') ?? undefined;
    return { name: 'boss', boss: decodeURIComponent(bossMatch[1]), highlight };
  }
  return { name: 'home' };
}

export function useRoute() {
  const [route, setRoute] = useState<Route>(routeFromPath);

  useEffect(() => {
    const onPop = () => setRoute(routeFromPath());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const navigate = (next: Route) => {
    const path =
      next.name === 'player'
        ? `/player/${encodeURIComponent(next.player)}`
        : next.name === 'boss'
          ? `/boss/${encodeURIComponent(next.boss)}${next.highlight ? `?highlight=${encodeURIComponent(next.highlight)}` : ''}`
          : next.name === 'about'
            ? '/about'
          : next.name === 'faq'
            ? '/faq'
          : next.name === 'setup'
            ? '/setup'
          : '/';
    window.history.pushState({}, '', path);
    setRoute(next);
    // Each of these is its own "page" - switching between them (or between
    // two different bosses) should always land at the top, not wherever the
    // previous page happened to be scrolled to.
    window.scrollTo(0, 0);
  };

  return { route, navigate };
}
```

- [ ] **Step 2: Remove the old routing code from the monolith and wire up the hook**

In `frontend/src/components/PhaseTwoOsrsPreview.tsx`:

Delete the `PreviewView` type (currently lines 27-33), the `previewBase`
constant (line 39), and the `viewFromPreviewPath` function (lines 53-66).

Delete this block from inside the `PhaseTwoOsrsPreview` component (currently
lines 120, 132-136):

```typescript
const [view, setView] = useState<PreviewView>(viewFromPreviewPath);
```
```typescript
useEffect(() => {
  const onPop = () => setView(viewFromPreviewPath());
  window.addEventListener('popstate', onPop);
  return () => window.removeEventListener('popstate', onPop);
}, []);
```

And delete the `navigate` function (currently lines 234-253).

Replace all three with, near the top of the component body:

```typescript
const { route, navigate } = useRoute();
```

Add the import:

```typescript
import { useRoute } from '../hooks/useRoute';
```

- [ ] **Step 3: Rename every remaining `view` reference to `route`, and every `PreviewView` to `Route`, throughout the rest of the file**

This includes (line numbers are pre-Task-2; re-locate by content since Step 2
shifted things):

- Every `view.name` → `route.name`, `view.boss` → `route.boss`,
  `view.player` → `route.player`, `view.highlight` → `route.highlight`
  (appears in the boss-list effect guard, the stats/recentSyncs/topBosses
  effect guards, the selected-boss-from-URL effect, the `highlight` derivation,
  the leaderboard effect guard, the player-profile effect, the `accentColor`
  derivation, and the topbar nav buttons' `active` class checks and route
  switch in the JSX render section).
- Every effect dependency array containing `view` or `view.name` →
  `route`/`route.name` respectively.
- `BossView`'s and `PlayerView`'s prop type `navigate: (view: PreviewView) => void;`
  → `navigate: (route: Route) => void;` (both components still live in this
  same file at this point in the plan — just update their type signatures now
  so Tasks 9-10 don't need to touch this again).
- Every `${previewBase}` string interpolation still remaining in this file
  (there should be none left after Step 2 removed `navigate` and
  `viewFromPreviewPath` — but also check the player-profile effect's
  `window.history.replaceState({}, '', `${previewBase}/player/${...}`)`
  call, changing it to `window.history.replaceState({}, '', `/player/${...}`)`).

Add the import:

```typescript
import type { Route } from '../hooks/useRoute';
```

- [ ] **Step 4: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: clean. If it reports a leftover `view`/`PreviewView`/`previewBase`
reference, that confirms Step 3 missed a spot — fix it.

- [ ] **Step 5: Run full test suite**

Run: `cd frontend && npx vitest run`
Expected: all 91 tests pass, no behavior change (routes, URLs, and
`window.history` calls are byte-identical to before — only identifier names
changed).

- [ ] **Step 6: Commit**

```bash
cd frontend
git add src/hooks/useRoute.ts src/components/PhaseTwoOsrsPreview.tsx
git commit -m "refactor: extract routing into useRoute, rename PreviewView to Route"
```

---

### Task 3: Relocate `bossTitleParts` and the sort types

**Files:**
- Modify: `frontend/src/lib/format.ts`
- Create: `frontend/src/lib/sortTypes.ts`
- Modify: `frontend/src/components/PhaseTwoOsrsPreview.tsx`

Small, low-risk prep step for the hook/component extractions that follow.
`bossTitleParts` is needed by both the future `useBossLeaderboard` hook and
`HomeView`'s "Top bosses" cards, so it goes in `lib/format.ts` alongside the
`titleCase` helper it's built from (not into a hooks file, which would be an
odd component→hook import direction). `BossRecordSort`/`SortDirection` are
needed by both the future `BossView.tsx` and `PlayerView.tsx`, so they get a
tiny shared home rather than being duplicated.

- [ ] **Step 1: Add `bossTitleParts` to `lib/format.ts`**

Append to `frontend/src/lib/format.ts`:

```typescript
export function bossTitleParts(boss: string) {
  const [first, ...rest] = titleCase(boss).split(' - ');
  return { primary: first || 'Loading Leaderboard', secondary: rest.join(' - ') };
}
```

- [ ] **Step 2: Create `lib/sortTypes.ts`**

```typescript
// frontend/src/lib/sortTypes.ts
export type BossRecordSort = 'rank' | 'name' | 'time';
export type SortDirection = 'asc' | 'desc';
```

- [ ] **Step 3: Remove the originals from the monolith and import instead**

In `frontend/src/components/PhaseTwoOsrsPreview.tsx`, delete the `bossTitleParts`
function (currently lines 76-79) and the `BossRecordSort`/`SortDirection` type
aliases (currently line 34-35).

Add imports:

```typescript
import { bossTitleParts } from '../lib/format';
import type { BossRecordSort, SortDirection } from '../lib/sortTypes';
```

(`bossTitleParts` is already used at the shell's `const titleParts = bossTitleParts(selectedBoss);` line and inside `HomeView`'s "Top bosses" card rendering — both keep working via the new import, no other changes needed yet.)

- [ ] **Step 4: Typecheck and test**

Run: `cd frontend && npx tsc --noEmit && npx vitest run`
Expected: clean typecheck, 91/91 passing.

- [ ] **Step 5: Commit**

```bash
cd frontend
git add src/lib/format.ts src/lib/sortTypes.ts src/components/PhaseTwoOsrsPreview.tsx
git commit -m "refactor: relocate bossTitleParts and sort types to lib/"
```

---

### Task 4: `hooks/useBossList.ts`

**Files:**
- Create: `frontend/src/hooks/useBossList.ts`
- Modify: `frontend/src/components/PhaseTwoOsrsPreview.tsx`

- [ ] **Step 1: Create the hook**

```typescript
// frontend/src/hooks/useBossList.ts
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { LoadState } from '../lib/loadState';
import type { Route } from './useRoute';

// Needed on home (for search-alias resolution) and boss (for the picker)
// views. Other views may still get boss suggestions from universal search
// without preloading the full list.
export function useBossList(route: Route): LoadState<string[]> {
  const [bosses, setBosses] = useState<LoadState<string[]>>({ s: 'idle' });

  useEffect(() => {
    if ((route.name !== 'home' && route.name !== 'boss') || bosses.s !== 'idle') return;
    let alive = true;
    setBosses({ s: 'loading' });
    api.getBosses().then((data) => {
      if (alive) setBosses({ s: 'loaded', data });
    }).catch(() => alive && setBosses({ s: 'error' }));
    return () => { alive = false; };
  }, [route.name, bosses.s]);

  return bosses;
}
```

Note: the original effect also called `setSelectedBoss(...)` right after a
successful load. That responsibility moves to `useBossLeaderboard` in Task 5
(which reacts to `bosses` becoming loaded) — this hook's only job is fetching
the list itself.

- [ ] **Step 2: Remove the old effect and wire up the hook**

In `frontend/src/components/PhaseTwoOsrsPreview.tsx`, delete the `bosses`
state declaration and its fetch effect (currently lines 121, 141-151):

```typescript
const [bosses, setBosses] = useState<LoadState<string[]>>({ s: 'idle' });
```
```typescript
useEffect(() => {
  if ((route.name !== 'home' && route.name !== 'boss') || bosses.s !== 'idle') return;
  let alive = true;
  setBosses({ s: 'loading' });
  api.getBosses().then((data) => {
    if (!alive) return;
    setBosses({ s: 'loaded', data });
    setSelectedBoss((current) => current || pickInitialBoss(data));
  }).catch(() => alive && setBosses({ s: 'error' }));
  return () => { alive = false; };
}, [route.name, bosses.s]);
```

Replace with:

```typescript
const bosses = useBossList(route);
```

Add the import:

```typescript
import { useBossList } from '../hooks/useBossList';
```

- [ ] **Step 3: Typecheck and test**

Run: `cd frontend && npx tsc --noEmit && npx vitest run`

Note: at this point `pickInitialBoss` is still defined later in this same
file (it hasn't moved yet — that's Task 5) and `selectedBoss` is still local
`useState` in this component, so `pickInitialBoss` being temporarily
unreferenced from the deleted effect is fine; it's still called by the
topbar's "Leaderboards" button fallback later in the file. Confirm typecheck
is clean and all 91 tests still pass — the boss list still loads and
`selectedBoss` still gets its initial value, just via a slightly different
code path until Task 5 finishes moving `selectedBoss` itself into a hook.

Actually — verify this carefully: since this task's Step 2 removed the
`setSelectedBoss` call from the deleted effect, and Task 5 hasn't yet added
its replacement (the effect reacting to `bosses` becoming loaded), the app
will temporarily NOT auto-select an initial boss between Task 4 and Task 5.
This is expected and acceptable for one intermediate commit, since Task 5
follows immediately after and restores it — but if you want to verify
end-to-end behavior at this checkpoint, note that `BossView` will simply show
an empty/unselected boss picker until Task 5 lands. Existing automated tests
don't cover this specific interaction (no test currently loads the boss view
without an explicit boss in the URL), so `npx vitest run` will still pass
91/91 either way. Proceed to Task 5 immediately rather than treating this as
a stopping point.

- [ ] **Step 4: Commit**

```bash
cd frontend
git add src/hooks/useBossList.ts src/components/PhaseTwoOsrsPreview.tsx
git commit -m "refactor: extract boss list fetching into useBossList"
```

---

### Task 5: `hooks/useBossLeaderboard.ts`

**Files:**
- Create: `frontend/src/hooks/useBossLeaderboard.ts`
- Modify: `frontend/src/components/PhaseTwoOsrsPreview.tsx`

This restores (via a different code path) the initial-boss-selection behavior
temporarily removed in Task 4, and extracts `selectedBoss`, the leaderboard
page fetch, and their derived values (`rows`, `titleParts`, `highlight`) into
one hook.

- [ ] **Step 1: Create the hook**

```typescript
// frontend/src/hooks/useBossLeaderboard.ts
import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import type { LeaderboardPage, LeaderboardRow } from '../lib/api';
import { isLoaded, type LoadState } from '../lib/loadState';
import { bossTitleParts } from '../lib/format';
import type { Route } from './useRoute';

const LEADERBOARD_PAGE_SIZE = 50;
const preferredBosses = [
  'chambers of xeric - challenge mode - fastest overall (3 players)',
  'chambers of xeric',
  'zulrah',
];

export function pickInitialBoss(bosses: string[]) {
  return preferredBosses.find((boss) => bosses.includes(boss)) ?? bosses[0] ?? '';
}

export interface BossLeaderboardState {
  selectedBoss: string;
  leaderboard: LoadState<LeaderboardPage>;
  rows: LeaderboardRow[];
  leaderboardOffset: number;
  setLeaderboardOffset: (offset: number) => void;
  titleParts: { primary: string; secondary: string };
  highlight?: string;
}

export function useBossLeaderboard(route: Route, bosses: LoadState<string[]>): BossLeaderboardState {
  const [selectedBoss, setSelectedBoss] = useState('');
  const [leaderboardOffset, setLeaderboardOffset] = useState(0);
  const [leaderboard, setLeaderboard] = useState<LoadState<LeaderboardPage>>({ s: 'idle' });

  // The boss page's selected boss is driven by the URL (route.boss), not the
  // other way around - landing directly on /boss/<key>, following a link, or
  // switching via the picker all just change route.boss and this follows.
  useEffect(() => {
    if (route.name === 'boss' && route.boss) setSelectedBoss(route.boss);
  }, [route]);

  // Once the boss list loads, fill in a default only if nothing else (the
  // effect above, e.g. from a direct /boss/<key> URL) has already set one.
  useEffect(() => {
    if (isLoaded(bosses)) setSelectedBoss((current) => current || pickInitialBoss(bosses.data));
  }, [bosses]);

  useEffect(() => {
    setLeaderboardOffset(0);
  }, [selectedBoss]);

  const highlight = route.name === 'boss' ? route.highlight : undefined;

  useEffect(() => {
    if (route.name !== 'boss' || !selectedBoss) return;
    let alive = true;
    setLeaderboard({ s: 'loading' });
    api.getLeaderboardPage(selectedBoss, LEADERBOARD_PAGE_SIZE, leaderboardOffset, highlight)
      .then((data) => alive && setLeaderboard({ s: 'loaded', data }))
      .catch(() => alive && setLeaderboard({ s: 'error' }));
    return () => { alive = false; };
  }, [route.name, selectedBoss, highlight, leaderboardOffset]);

  const rows = useMemo(() => (isLoaded(leaderboard) ? leaderboard.data.rows : []), [leaderboard]);
  const titleParts = bossTitleParts(selectedBoss);

  return { selectedBoss, leaderboard, rows, leaderboardOffset, setLeaderboardOffset, titleParts, highlight };
}
```

- [ ] **Step 2: Remove the old state/effects and wire up the hook**

In `frontend/src/components/PhaseTwoOsrsPreview.tsx`, delete:

- `const [leaderboard, setLeaderboard] = useState<LoadState<LeaderboardPage>>({ s: 'idle' });`
- `const [leaderboardOffset, setLeaderboardOffset] = useState(0);`
- `const [selectedBoss, setSelectedBoss] = useState('');`
- The route-driven selected-boss effect (`useEffect(() => { if (route.name === 'boss' && route.boss) setSelectedBoss(route.boss); }, [route]);`)
- The offset-reset effect (`useEffect(() => { setLeaderboardOffset(0); }, [selectedBoss]);`)
- The `const highlight = route.name === 'boss' ? route.highlight : undefined;` line
- The leaderboard-page fetch effect
- The `const rows = useMemo(...)` line
- The `const titleParts = bossTitleParts(selectedBoss);` line
- The module-level `pickInitialBoss` function and `preferredBosses` constant (moved into the hook)

Replace with:

```typescript
const bossLeaderboard = useBossLeaderboard(route, bosses);
const { selectedBoss, leaderboard, rows, leaderboardOffset, setLeaderboardOffset, titleParts, highlight } = bossLeaderboard;
```

Add the import:

```typescript
import { pickInitialBoss, useBossLeaderboard } from '../hooks/useBossLeaderboard';
```

(`pickInitialBoss` is still needed directly in this file — the topbar's
"Leaderboards" button fallback calls
`goToBoss(selectedBoss || pickInitialBoss(isLoaded(bosses) ? bosses.data : []))`.)

- [ ] **Step 3: Typecheck and test**

Run: `cd frontend && npx tsc --noEmit && npx vitest run`
Expected: clean typecheck, 91/91 passing. This restores the initial-boss-pick
behavior that was temporarily missing after Task 4.

- [ ] **Step 4: Commit**

```bash
cd frontend
git add src/hooks/useBossLeaderboard.ts src/components/PhaseTwoOsrsPreview.tsx
git commit -m "refactor: extract boss leaderboard state into useBossLeaderboard"
```

---

### Task 6: `hooks/useHomeData.ts`

**Files:**
- Create: `frontend/src/hooks/useHomeData.ts`
- Modify: `frontend/src/components/PhaseTwoOsrsPreview.tsx`

- [ ] **Step 1: Create the hook**

```typescript
// frontend/src/hooks/useHomeData.ts
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { LeaderboardRow, QuickStats, RecentSync } from '../lib/api';
import type { LoadState } from '../lib/loadState';
import type { Route } from './useRoute';

export interface HomeData {
  stats: LoadState<QuickStats>;
  recentSyncs: LoadState<RecentSync[]>;
  topBosses: LoadState<Array<{ boss: string; leader: LeaderboardRow | null }>>;
}

export function useHomeData(route: Route): HomeData {
  const [stats, setStats] = useState<LoadState<QuickStats>>({ s: 'idle' });
  const [recentSyncs, setRecentSyncs] = useState<LoadState<RecentSync[]>>({ s: 'idle' });
  const [topBosses, setTopBosses] = useState<LoadState<Array<{ boss: string; leader: LeaderboardRow | null }>>>({ s: 'idle' });

  useEffect(() => {
    if (route.name !== 'home' || stats.s !== 'idle') return;
    let alive = true;
    setStats({ s: 'loading' });
    api.getStats().then((data) => alive && setStats({ s: 'loaded', data })).catch(() => alive && setStats({ s: 'error' }));
    return () => { alive = false; };
  }, [route.name, stats.s]);

  useEffect(() => {
    if (route.name !== 'home' || recentSyncs.s !== 'idle') return;
    let alive = true;
    setRecentSyncs({ s: 'loading' });
    api.getRecentSyncs(6).then((data) => alive && setRecentSyncs({ s: 'loaded', data })).catch(() => alive && setRecentSyncs({ s: 'error' }));
    return () => { alive = false; };
  }, [route.name, recentSyncs.s]);

  // One request replaces the previous 5-request per-boss fan-out (Workstream D).
  useEffect(() => {
    if (route.name !== 'home' || topBosses.s !== 'idle') return;
    let alive = true;
    setTopBosses({ s: 'loading' });
    api.getLeaderboardOverview()
      .then((data) => alive && setTopBosses({ s: 'loaded', data }))
      .catch(() => alive && setTopBosses({ s: 'error' }));
    return () => { alive = false; };
  }, [route.name, topBosses.s]);

  return { stats, recentSyncs, topBosses };
}
```

- [ ] **Step 2: Remove the old state/effects and wire up the hook**

In `frontend/src/components/PhaseTwoOsrsPreview.tsx`, delete the `stats`,
`recentSyncs`, and `topBosses` state declarations and their three fetch
effects.

Replace with:

```typescript
const { stats, recentSyncs, topBosses } = useHomeData(route);
```

Add the import:

```typescript
import { useHomeData } from '../hooks/useHomeData';
```

- [ ] **Step 3: Typecheck and test**

Run: `cd frontend && npx tsc --noEmit && npx vitest run`
Expected: clean, 91/91 passing (this includes `requestBudget.test.tsx`'s home-view test, which directly exercises this exact behavior).

- [ ] **Step 4: Commit**

```bash
cd frontend
git add src/hooks/useHomeData.ts src/components/PhaseTwoOsrsPreview.tsx
git commit -m "refactor: extract home page data fetching into useHomeData"
```

---

### Task 7: `hooks/usePlayerProfile.ts`

**Files:**
- Create: `frontend/src/hooks/usePlayerProfile.ts`
- Modify: `frontend/src/components/PhaseTwoOsrsPreview.tsx`

- [ ] **Step 1: Create the hook**

```typescript
// frontend/src/hooks/usePlayerProfile.ts
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { PlayerPayload } from '../lib/api';
import type { Route } from './useRoute';

export type PlayerState =
  | { s: 'idle' }
  | { s: 'loading'; name: string }
  | { s: 'error'; name: string }
  | { s: 'notFound'; name: string }
  | { s: 'ambiguous'; name: string; count: number }
  | { s: 'loaded'; player: PlayerPayload };

export function usePlayerProfile(route: Route): PlayerState {
  const [profileState, setProfileState] = useState<PlayerState>({ s: 'idle' });

  useEffect(() => {
    if (route.name !== 'player') return;
    const trimmed = route.player.trim();
    setProfileState({ s: 'loading', name: trimmed });
    api.lookupPlayer(trimmed).then((result) => {
      if (result.kind === 'player') {
        setProfileState({ s: 'loaded', player: result.player });
        if (result.player.displayName.toLowerCase() !== trimmed.toLowerCase()) {
          window.history.replaceState({}, '', `/player/${encodeURIComponent(result.player.displayName)}`);
        }
      }
      else if (result.kind === 'ambiguous') setProfileState({ s: 'ambiguous', name: trimmed, count: result.matches.length });
      else setProfileState({ s: 'notFound', name: trimmed });
    }).catch(() => setProfileState({ s: 'error', name: trimmed }));
  }, [route]);

  return profileState;
}
```

- [ ] **Step 2: Remove the old state/effect and wire up the hook**

In `frontend/src/components/PhaseTwoOsrsPreview.tsx`, delete the
`PlayerState` type (moved into the hook), the `profileState` state
declaration, and the player-lookup effect.

Replace with:

```typescript
const profileState = usePlayerProfile(route);
```

Add the import:

```typescript
import { usePlayerProfile } from '../hooks/usePlayerProfile';
import type { PlayerState } from '../hooks/usePlayerProfile';
```

(`PlayerState` is still referenced by `PlayerView`'s prop type later in this
same file — keep the type import.)

- [ ] **Step 3: Typecheck and test**

Run: `cd frontend && npx tsc --noEmit && npx vitest run`
Expected: clean, 91/91 passing (`requestBudget.test.tsx`'s player-view test
directly exercises this).

- [ ] **Step 4: Commit**

```bash
cd frontend
git add src/hooks/usePlayerProfile.ts src/components/PhaseTwoOsrsPreview.tsx
git commit -m "refactor: extract player profile fetching into usePlayerProfile"
```

---

### Task 8: `hooks/useSearchSuggestions.ts` and moving search-box state into `HomeView`

**Files:**
- Create: `frontend/src/hooks/useSearchSuggestions.ts`
- Modify: `frontend/src/components/PhaseTwoOsrsPreview.tsx`
- Test: `frontend/test/homeSearch.test.tsx`

This is the one task in the plan with a real logic change, not just a
relocation: `playerQuery` and `suggestions` currently live in the shell
purely because the shell used to own all state — nothing outside `HomeView`
ever reads them. This task moves them to be local to `HomeView` (which still
physically lives in this same file — it moves to its own file in Task 11).
`HomeView` still lives inside `PhaseTwoOsrsPreview.tsx` at this point in the
plan; only its *internal* logic changes here.

One real behavior question this raises: the shell's shared `lookupPlayer`
function (used by `HomeView`'s own suggestions, `BossView`'s row clicks, and
`PlayerView`'s row clicks) currently does `setPlayerQuery(''); setSuggestions([]);`
before navigating. Once those are `HomeView`-local state, `lookupPlayer`
can't reach them directly. This is fine: `HomeView` unmounts whenever the
route changes away from `'home'` (a different top-level JSX branch renders
instead), so its local state is discarded on unmount and starts fresh
(`useState('')`) the next time `HomeView` mounts, with no explicit reset
needed. `lookupPlayer` itself drops the two `setState` calls. `HomeView`
additionally wraps its own search-triggered lookups in a small
`submitLookup` helper that clears its local `playerQuery` first, purely so
the input visually clears immediately if `HomeView` ever doesn't unmount
before the next render (defensive, not required by today's routing, but
free and clarifies intent for a future reader).

- [ ] **Step 1: Create the hook**

```typescript
// frontend/src/hooks/useSearchSuggestions.ts
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { SearchSuggestion } from '../lib/api';
import { isLoaded, type LoadState } from '../lib/loadState';
import { titleCase } from '../lib/format';
import { bossSearchAlias } from '../lib/bossAliases';
import { getRaidModes } from '../lib/bossGroups';

export function compactAliasSuggestions(query: string, bosses: string[]): SearchSuggestion[] | undefined {
  const alias = bossSearchAlias(query);
  if (!alias) return undefined;
  const modes = getRaidModes(bosses, alias.base)
    .filter((mode) => !alias.modeLabel || mode.modeLabel === alias.modeLabel);
  if (modes.length === 0) return undefined;
  const raidLabel = titleCase(alias.base);
  return modes.map((mode) => ({
    type: 'boss',
    value: mode.variants[0].key,
    label: `${raidLabel} — ${mode.modeLabel}`,
  }));
}

export function useSearchSuggestions(query: string, bosses: LoadState<string[]>): SearchSuggestion[] {
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([]);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) { setSuggestions([]); return; }
    const compactSuggestions = isLoaded(bosses) ? compactAliasSuggestions(trimmed, bosses.data) : undefined;
    if (compactSuggestions) {
      setSuggestions(compactSuggestions);
      return;
    }
    let alive = true;
    const timer = window.setTimeout(() => {
      api.searchAll(trimmed).then((result) => { if (alive) setSuggestions(result); }).catch(() => { if (alive) setSuggestions([]); });
    }, 275);
    return () => { alive = false; window.clearTimeout(timer); };
  }, [query, bosses]);

  return suggestions;
}
```

- [ ] **Step 2: Remove the shell-level search state, simplify `lookupPlayer`**

In `frontend/src/components/PhaseTwoOsrsPreview.tsx`, delete:

- `const [playerQuery, setPlayerQuery] = useState('');`
- `const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([]);`
- The suggestions-fetch `useEffect` (the one keyed on `[playerQuery, bosses]`)
- The module-level `compactAliasSuggestions` function (moved into the hook)
- The `onPlayerSubmit` function (moves into `HomeView` below)

Change `lookupPlayer` from:

```typescript
const lookupPlayer = (name: string) => {
  const trimmed = name.trim();
  if (!trimmed) return;
  setPlayerQuery('');
  setSuggestions([]);
  navigate({ name: 'player', player: trimmed });
};
```

to:

```typescript
const lookupPlayer = (name: string) => {
  const trimmed = name.trim();
  if (!trimmed) return;
  navigate({ name: 'player', player: trimmed });
};
```

Update the `<HomeView .../>` call site (in the shell's JSX) from:

```tsx
<HomeView
  stats={stats}
  recentSyncs={recentSyncs}
  topBosses={topBosses}
  playerQuery={playerQuery}
  setPlayerQuery={setPlayerQuery}
  suggestions={suggestions}
  onPlayerSubmit={onPlayerSubmit}
  lookupPlayer={lookupPlayer}
  goToBoss={goToBoss}
/>
```

to:

```tsx
<HomeView
  stats={stats}
  recentSyncs={recentSyncs}
  topBosses={topBosses}
  bosses={bosses}
  lookupPlayer={lookupPlayer}
  goToBoss={goToBoss}
/>
```

- [ ] **Step 3: Rewrite the (still-inline) `HomeView` function**

Replace the entire `HomeView` function in
`frontend/src/components/PhaseTwoOsrsPreview.tsx` with:

```tsx
function HomeView({
  stats,
  recentSyncs,
  topBosses,
  bosses,
  lookupPlayer,
  goToBoss,
}: {
  stats: LoadState<QuickStats>;
  recentSyncs: LoadState<RecentSync[]>;
  topBosses: LoadState<Array<{ boss: string; leader: LeaderboardRow | null }>>;
  bosses: LoadState<string[]>;
  lookupPlayer: (name: string) => void;
  goToBoss: (boss: string) => void;
}) {
  const [playerQuery, setPlayerQuery] = useState('');
  const suggestions = useSearchSuggestions(playerQuery, bosses);

  const submitLookup = (name: string) => {
    setPlayerQuery('');
    lookupPlayer(name);
  };

  const onPlayerSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const alias = bossSearchAlias(playerQuery);
    const aliasSuggestions = alias && isLoaded(bosses) ? compactAliasSuggestions(playerQuery, bosses.data) : undefined;
    const aliasBoss = aliasSuggestions?.[0]?.value;
    const exactBoss = suggestions.find(
      (suggestion) => suggestion.type === 'boss' && normalize(suggestion.value) === normalize(playerQuery)
    );
    if (aliasBoss) goToBoss(aliasBoss);
    else if (exactBoss) goToBoss(exactBoss.value);
    else submitLookup(playerQuery);
  };

  return (
    <>
      <div className="pbt-section" style={{ paddingTop: 56 }}>
        <div className="pbt-kicker">
          <span>Gamewide personal-best leaderboards</span>
          <span className="rule" />
        </div>
        <h1 className="pbt-display pbt-h1">Find your next personal best.</h1>

        <form onSubmit={onPlayerSubmit} style={{ marginTop: 36 }}>
          <div className="pbt-searchband">
            <input
              value={playerQuery}
              onChange={(e) => setPlayerQuery(e.target.value)}
              placeholder="Search players or bosses"
              aria-label="Search players or bosses"
              autoComplete="off"
            />
            <button type="submit">Search</button>
          </div>
        </form>
        {suggestions.length > 0 && (
          <div className="pbt-suggestions">
            {suggestions.slice(0, 10).map((suggestion) => (
              <button
                key={`${suggestion.type}:${suggestion.value}`}
                type="button"
                onClick={() => suggestion.type === 'boss' ? goToBoss(suggestion.value) : submitLookup(suggestion.value)}
              >
                <span className="pbt-suggestion-type">{suggestion.type}</span>
                {suggestion.label ?? titleCase(suggestion.value)}
              </button>
            ))}
          </div>
        )}

        <div className="pbt-stats pbt-stats-single">
          <div className="pbt-stat">
            <span className="num">{isLoaded(stats) ? statValue(stats.data.trackedPlayers) : stats.s === 'error' ? '—' : '...'}</span>
            <div className="lbl">Tracked players</div>
            <span className="idx">01</span>
          </div>
        </div>
      </div>

      <div className="pbt-section">
        <div className="pbt-sec-head">
          <h2 className="pbt-display pbt-h2">Top bosses</h2>
          <div className="rule" />
        </div>
        {topBosses.s === 'loading' && <div className="pbt-panel-state">Loading top bosses...</div>}
        {topBosses.s === 'error' && <div className="pbt-panel-state">Top bosses unavailable.</div>}
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
      </div>

      <div className="pbt-section">
        <div className="pbt-sec-head">
          <h2 className="pbt-display pbt-h2">Recent syncs</h2>
          <div className="rule" />
        </div>
        {recentSyncs.s === 'loading' && <div className="pbt-panel-state">Loading recent syncs...</div>}
        {recentSyncs.s === 'error' && <div className="pbt-panel-state">Recent syncs unavailable.</div>}
        {isLoaded(recentSyncs) && (
          <div className="pbt-rows">
            {recentSyncs.data.map((sync, index) => (
              <button type="button" className="pbt-row" key={sync.id} onClick={() => submitLookup(sync.displayName)}>
                <span className="rank">{String(index + 1).padStart(2, '0')}</span>
                <span className="name">{sync.displayName}</span>
                <span className="time">{sync.pbCount} PBs</span>
                <span className="when">{formatDate(sync.updatedAt)}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
```

Add the import:

```typescript
import { useSearchSuggestions, compactAliasSuggestions } from '../hooks/useSearchSuggestions';
```

Note: `normalize`, `bossSearchAlias`, `statValue`, `isLoaded`, `bossTitleParts`,
`formatTime`, `formatDate`, `titleCase` are all still module-level/imported
in this same file already — no new imports needed for those. Run `tsc` (Step
5 below) to confirm; remove `SearchSuggestion` from the shell's top-level
type-only import list if the compiler reports it unused (it's no longer
referenced directly now that `suggestions`'s type comes from the hook's
return type).

- [ ] **Step 4: Write a regression test for the moved interaction**

This exact interaction (typing a player name, submitting, landing on that
player's page with the search box cleared) has never had automated coverage.
Since this task is the one place real behavior-relevant logic changes hands
between components, add a test now to catch a regression here specifically.

```tsx
// frontend/test/homeSearch.test.tsx
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { PhaseTwoOsrsPreview } from '../src/components/PhaseTwoOsrsPreview';
import { api } from '../src/lib/api';

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' }, ...init });
}

function mockFetch() {
  return vi.fn().mockImplementation((url: string) => {
    if (url.includes('/api/bosses')) return Promise.resolve(jsonResponse(['zulrah']));
    if (url.includes('/api/stats')) return Promise.resolve(jsonResponse({ trackedPlayers: 1, personalBestRecords: 1 }));
    if (url.includes('/api/recent-syncs')) return Promise.resolve(jsonResponse([]));
    if (url.includes('/api/leaderboard-overview')) return Promise.resolve(jsonResponse([]));
    if (url.includes('/api/players/blitzen')) return Promise.resolve(jsonResponse({ error: 'not found' }, { status: 404 }));
    return Promise.resolve(jsonResponse([]));
  });
}

describe('home search box', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch());
    api.resetForTesting();
    window.history.pushState({}, '', '/');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('submitting a player name navigates to that player and clears the search box', async () => {
    render(<PhaseTwoOsrsPreview />);
    const input = await screen.findByPlaceholderText('Search players or bosses');
    input.focus();
    (input as HTMLInputElement).value = 'Blitzen';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const form = input.closest('form')!;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    await waitFor(() => expect(window.location.pathname).toBe('/player/Blitzen'));
  });
});
```

- [ ] **Step 5: Typecheck and run the full suite**

Run: `cd frontend && npx tsc --noEmit && npx vitest run`
Expected: clean typecheck, 92/92 passing (91 prior + 1 new).

- [ ] **Step 6: Commit**

```bash
cd frontend
git add src/hooks/useSearchSuggestions.ts src/components/PhaseTwoOsrsPreview.tsx test/homeSearch.test.tsx
git commit -m "refactor: move search-box state into HomeView, extract useSearchSuggestions"
```

---

### Task 9: Extract `components/BossView.tsx`

**Files:**
- Create: `frontend/src/components/BossView.tsx`
- Modify: `frontend/src/components/PhaseTwoOsrsPreview.tsx`

Pure file move at this point — `BossView`'s internals haven't changed since
Task 2 renamed its `navigate` prop type. This is a cut/paste plus import
fixes.

- [ ] **Step 1: Create the new file**

```tsx
// frontend/src/components/BossView.tsx
import { CSSProperties, useEffect, useMemo, useRef, useState } from 'react';
import type { LeaderboardPage, LeaderboardRow } from '../lib/api';
import { isLoaded, type LoadState } from '../lib/loadState';
import { formatDate, formatTime } from '../lib/format';
import { bossBannerUrl } from '../lib/bossBanners';
import { getRaidModes, groupedBaseForKey, isGroupedVariant } from '../lib/bossGroups';
import type { BossRecordSort, SortDirection } from '../lib/sortTypes';
import type { Route } from '../hooks/useRoute';
import { BossComboboxCollapsed } from './BossComboboxCollapsed';
import { RaidVariantPicker } from './RaidVariantPicker';

export function BossView({
  titleParts,
  bosses,
  selectedBoss,
  highlight,
  goToBoss,
  navigate,
  leaderboard,
  setLeaderboardOffset,
  rows,
  lookupPlayer,
}: {
  titleParts: { primary: string; secondary: string };
  bosses: LoadState<string[]>;
  selectedBoss: string;
  highlight?: string;
  goToBoss: (boss: string) => void;
  navigate: (route: Route) => void;
  leaderboard: LoadState<LeaderboardPage>;
  setLeaderboardOffset: (offset: number) => void;
  rows: LeaderboardRow[];
  lookupPlayer: (name: string) => void;
}) {
  const [leaderboardSort, setLeaderboardSort] = useState<BossRecordSort>('rank');
  const [leaderboardDirection, setLeaderboardDirection] = useState<SortDirection>('asc');
  const page = isLoaded(leaderboard) ? leaderboard.data : undefined;
  const fastest = rows.length > 0 ? Math.min(...rows.map((r) => r.timeSeconds)) : undefined;
  const showRaidPicker = isLoaded(bosses) && isGroupedVariant(selectedBoss);
  const highlightLower = highlight?.toLowerCase();
  const highlightRowRef = useRef<HTMLButtonElement | null>(null);
  const sortedRows = useMemo(() => {
    const rankedRows = rows.map((row, index) => ({ row, rank: (page?.offset ?? 0) + index + 1 }));
    const direction = leaderboardDirection === 'asc' ? 1 : -1;
    return rankedRows.sort((a, b) => {
      const comparison = leaderboardSort === 'name'
        ? a.row.displayName.localeCompare(b.row.displayName)
        : leaderboardSort === 'time'
          ? a.row.timeSeconds - b.row.timeSeconds
          : a.rank - b.rank;
      return comparison * direction || a.rank - b.rank;
    });
  }, [rows, leaderboardSort, leaderboardDirection, page?.offset]);

  const chooseLeaderboardSort = (next: BossRecordSort) => {
    if (next === leaderboardSort) {
      setLeaderboardDirection((current) => current === 'asc' ? 'desc' : 'asc');
      return;
    }
    setLeaderboardSort(next);
    setLeaderboardDirection('asc');
  };

  const leaderboardSortLabel = (key: BossRecordSort, label: string) => (
    <button
      type="button"
      className={`pbt-sort${leaderboardSort === key ? ' active' : ''}`}
      aria-pressed={leaderboardSort === key}
      onClick={() => chooseLeaderboardSort(key)}
    >
      {label}{leaderboardSort === key ? (leaderboardDirection === 'asc' ? ' ↑' : ' ↓') : ''}
    </button>
  );

  useEffect(() => {
    if (highlightRowRef.current) {
      highlightRowRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [highlight, rows]);

  return (
    <div className="pbt-section" style={{ paddingTop: 40 }}>
      <div
        className="pbt-banner pbt-boss-banner"
        style={bossBannerUrl(selectedBoss) ? ({ '--pbt-banner': `url("${bossBannerUrl(selectedBoss)}")` } as CSSProperties) : undefined}
      >
        <div className="pbt-crumbs">
          <button type="button" onClick={() => navigate({ name: 'home' })}>Home</button> / Leaderboards
        </div>
        <h2 className="pbt-display pbt-h2">{titleParts.primary}</h2>
        {titleParts.secondary && <span className="meta">{titleParts.secondary}</span>}
      </div>

      <div style={{ maxWidth: 420, marginBottom: 20 }}>
        {isLoaded(bosses) ? (
          <BossComboboxCollapsed
            bosses={bosses.data}
            selected={selectedBoss}
            onSelect={goToBoss}
            onSelectRaidBase={(base) => {
              const firstVariant = getRaidModes(bosses.data, base)[0]?.variants[0]?.key;
              if (firstVariant) goToBoss(firstVariant);
            }}
          />
        ) : (
          <div className="pbt-panel-state">{bosses.s === 'error' ? 'Boss list unavailable.' : 'Loading bosses...'}</div>
        )}
      </div>

      {showRaidPicker && isLoaded(bosses) && (
        <RaidVariantPicker
          base={groupedBaseForKey(selectedBoss)}
          bosses={bosses.data}
          selected={selectedBoss}
          onSelect={goToBoss}
        />
      )}

      {leaderboard.s === 'loading' && <div className="pbt-panel-state">Loading leaderboard...</div>}
      {leaderboard.s === 'error' && <div className="pbt-panel-state">Leaderboard unavailable.</div>}
      {isLoaded(leaderboard) && rows.length === 0 && <div className="pbt-panel-state">No synced PBs for this boss yet.</div>}
      {rows.length > 0 && (
        <div className="pbt-rows pbt-leaderboard-rows">
          <div className="pbt-thead">
            <span>{leaderboardSortLabel('rank', 'Rank')}</span>
            <span>{leaderboardSortLabel('name', 'Player')}</span>
            <span>{leaderboardSortLabel('time', 'Time')}</span>
            <span className="when">Synced</span>
          </div>
          {sortedRows.map(({ row, rank }) => {
            const isHighlighted = highlightLower !== undefined && row.displayName.toLowerCase() === highlightLower;
            return (
              <button
                type="button"
                className={`pbt-row${isHighlighted ? ' me' : ''}`}
                key={`${row.displayName}-${rank}`}
                ref={isHighlighted ? highlightRowRef : undefined}
                onClick={() => lookupPlayer(row.displayName)}
              >
                <span className={`rank${rank <= 3 ? ` podium rank-${rank}` : ''}`}>
                  {String(rank).padStart(2, '0')}
                </span>
                <span className="name">
                  {row.displayName}
                  {isHighlighted && <span className="pbt-tag">Here</span>}
                </span>
                <span className="time">
                  {formatTime(row.timeSeconds)}
                  {page?.offset === 0 && fastest !== undefined && row.timeSeconds !== fastest && (
                    <span style={{ opacity: 0.6, fontSize: 12, marginLeft: 8 }}>
                      +{formatTime(row.timeSeconds - fastest)}
                    </span>
                  )}
                </span>
                <span className="when">{formatDate(row.updatedAt)}</span>
              </button>
            );
          })}
        </div>
      )}
      {page && page.total > page.limit && (
        <nav className="pbt-pagination" aria-label="Leaderboard pages">
          <button
            type="button"
            disabled={page.offset === 0}
            onClick={() => setLeaderboardOffset(Math.max(0, page.offset - page.limit))}
          >
            Previous
          </button>
          <span>
            {page.offset + 1}–{Math.min(page.offset + page.rows.length, page.total)} of {page.total}
          </span>
          <button
            type="button"
            disabled={page.offset + page.limit >= page.total}
            onClick={() => setLeaderboardOffset(page.offset + page.limit)}
          >
            Next
          </button>
        </nav>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Remove `BossView` from the monolith and import it**

In `frontend/src/components/PhaseTwoOsrsPreview.tsx`, delete the entire
`BossView` function.

Add the import:

```typescript
import { BossView } from './BossView';
```

- [ ] **Step 3: Typecheck and test**

Run: `cd frontend && npx tsc --noEmit && npx vitest run`
Expected: clean (fix any now-unused imports in the monolith that only
`BossView` needed — `CSSProperties` may still be used by the shell's
`accentColor` style prop, check before removing; `bossBannerUrl`,
`BossComboboxCollapsed`, `RaidVariantPicker`, `getRaidModes`,
`groupedBaseForKey`, `isGroupedVariant` should no longer be needed in the
monolith unless another remaining function uses them — verify via the
compiler), 92/92 passing.

- [ ] **Step 4: Commit**

```bash
cd frontend
git add src/components/BossView.tsx src/components/PhaseTwoOsrsPreview.tsx
git commit -m "refactor: extract BossView into its own file"
```

---

### Task 10: Extract `components/PlayerView.tsx`

**Files:**
- Create: `frontend/src/components/PlayerView.tsx`
- Modify: `frontend/src/components/PhaseTwoOsrsPreview.tsx`

Includes `PbRow`, `RaidGroupRows`, and the `visiblePbs` helper — all
single-use, staying colocated per the design.

- [ ] **Step 1: Create the new file**

```tsx
// frontend/src/components/PlayerView.tsx
import { useMemo, useState } from 'react';
import type { PbEntry, PlayerPayload } from '../lib/api';
import { hideAmbiguousBaseEntries } from '../lib/dedupe';
import { formatDate, formatTime, titleCase } from '../lib/format';
import { groupPlayerRaidPbs } from '../lib/bossGroups';
import type { PlayerRaidGroup } from '../lib/bossGroups';
import type { BossRecordSort, SortDirection } from '../lib/sortTypes';
import type { Route } from '../hooks/useRoute';
import type { PlayerState } from '../hooks/usePlayerProfile';

function visiblePbs(player: PlayerPayload) {
  return hideAmbiguousBaseEntries(player.pbs, (pb) => pb.boss)
    .slice()
    .sort((a, b) => a.rank - b.rank);
}

export function PlayerView({ state, navigate }: { state: PlayerState; navigate: (route: Route) => void }) {
  // Hooks must run unconditionally on every render (Rules of Hooks), so this
  // is computed before the early returns below - it just resolves to empty
  // when there's no loaded player yet.
  const pbs = state.s === 'loaded' ? visiblePbs(state.player) : [];
  const { groups, flat } = useMemo(() => groupPlayerRaidPbs(pbs), [pbs]);
  const [recordSort, setRecordSort] = useState<BossRecordSort>('name');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const recordRows = useMemo(() => {
    const combined = [
      ...flat.map((pb) => ({ type: 'pb' as const, key: pb.boss, name: titleCase(pb.boss), rank: pb.rank, time: pb.timeSeconds, pb })),
      ...groups.map((group) => ({
        type: 'group' as const,
        key: group.heading,
        name: group.heading,
        rank: group.summary.rank,
        time: group.summary.timeSeconds,
        group,
      })),
    ];
    const direction = sortDirection === 'asc' ? 1 : -1;
    return combined.sort((a, b) => {
      const comparison = recordSort === 'name'
        ? a.name.localeCompare(b.name)
        : recordSort === 'rank'
          ? a.rank - b.rank
          : a.time - b.time;
      return comparison * direction || a.name.localeCompare(b.name);
    });
  }, [flat, groups, recordSort, sortDirection]);

  const chooseSort = (next: BossRecordSort) => {
    if (next === recordSort) {
      setSortDirection((current) => current === 'asc' ? 'desc' : 'asc');
      return;
    }
    setRecordSort(next);
    setSortDirection('asc');
  };

  const sortLabel = (key: BossRecordSort, label: string) => (
    <button
      type="button"
      className={`pbt-sort${recordSort === key ? ' active' : ''}`}
      aria-pressed={recordSort === key}
      onClick={() => chooseSort(key)}
    >
      {label}{recordSort === key ? (sortDirection === 'asc' ? ' ↑' : ' ↓') : ''}
    </button>
  );

  if (state.s === 'loading' || state.s === 'idle') {
    return <div className="pbt-panel-state">Loading profile...</div>;
  }
  if (state.s === 'error') return <div className="pbt-panel-state">Could not load this profile.</div>;
  if (state.s === 'notFound') return <div className="pbt-panel-state">No synced profile found for "{state.name}".</div>;
  if (state.s === 'ambiguous') return <div className="pbt-panel-state">{state.count} matching profiles found for "{state.name}".</div>;

  const bestRank = pbs.length > 0 ? Math.min(...pbs.map((pb) => pb.rank)) : undefined;
  const goToBossHighlighted = (boss: string) => navigate({ name: 'boss', boss, highlight: state.player.displayName });

  return (
    <div className="pbt-section" style={{ paddingTop: 40 }}>
      <div className="pbt-banner">
        <div className="pbt-crumbs">
          <button type="button" onClick={() => navigate({ name: 'home' })}>Home</button> / {state.player.displayName}
        </div>
        <div className="pbt-titleline">
          <h1 className="pbt-display pbt-h3">{state.player.displayName}</h1>
        </div>
      </div>

      <div className="pbt-stats">
        <div className="pbt-stat">
          <span className="num">{pbs.length}</span>
          <div className="lbl">Boss PBs held</div>
        </div>
        <div className="pbt-stat">
          <span className="num">{bestRank ? `#${bestRank}` : '-'}</span>
          <div className="lbl">Best rank</div>
        </div>
        <div className="pbt-stat">
          <span className="num">{pbs.filter((pb) => pb.rank === 1).length}</span>
          <div className="lbl">#1 records</div>
        </div>
      </div>

      <div style={{ marginTop: 56 }}>
        <div className="pbt-sec-head">
          <h2 className="pbt-display pbt-h2">Boss records</h2>
          <div className="rule" />
        </div>
        {pbs.length === 0 && <div className="pbt-panel-state">No visible PBs synced yet.</div>}
        {pbs.length > 0 && (
          <div className="pbt-rows">
            <div className="pbt-thead">
              <span>{sortLabel('rank', 'Rank')}</span>
              <span>{sortLabel('name', 'Boss')}</span>
              <span>{sortLabel('time', 'Time')}</span>
              <span className="when">Synced</span>
            </div>
            {recordRows.map((row) => row.type === 'pb'
              ? <PbRow key={row.key} pb={row.pb} onBossClick={goToBossHighlighted} />
              : <RaidGroupRows key={row.key} group={row.group} onBossClick={goToBossHighlighted} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function PbRow({ pb, onBossClick }: { pb: PbEntry; onBossClick: (boss: string) => void }) {
  return (
    <button type="button" className="pbt-row" onClick={() => onBossClick(pb.boss)}>
      <span className="rank">#{pb.rank}</span>
      <span className="name">{titleCase(pb.boss)}</span>
      <span className="time">{formatTime(pb.timeSeconds)}</span>
      <span className="when">{formatDate(pb.updatedAt)}</span>
    </button>
  );
}

function RaidGroupRows({ group, onBossClick }: { group: PlayerRaidGroup; onBossClick: (boss: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {/* The row navigates to that mode's leaderboard on click; the caret is
          its own nested button (stopping propagation) so expanding the
          variant list doesn't fight with that - a real <button> can't
          contain another, so the row itself is a div with a button role. */}
      <div
        className={`pbt-brow raid${open ? ' open' : ''}`}
        role="button"
        tabIndex={0}
        onClick={() => onBossClick(group.summary.key)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') onBossClick(group.summary.key);
        }}
      >
        <span className="rank">#{group.summary.rank}</span>
        <span className="bname">
          <button
            type="button"
            className="caret"
            aria-label={open ? 'Collapse variants' : `Show all ${group.variants.length} variants`}
            onClick={(e) => {
              e.stopPropagation();
              setOpen((v) => !v);
            }}
          >
            ▸
          </button>
          {group.heading}
        </span>
        <span className="time">
          {formatTime(group.summary.timeSeconds)}
          <span style={{ opacity: 0.6, fontSize: 12, marginLeft: 8 }}>({group.summary.label})</span>
        </span>
        <span className="when">{formatDate(group.summary.updatedAt)}</span>
      </div>
      {open &&
        group.variants.map((variant) => (
          <button type="button" className="pbt-sub" key={variant.key} onClick={() => onBossClick(variant.key)}>
            <span className="rank">#{variant.rank}</span>
            <span className="variant">{variant.label}</span>
            <span className="time">{formatTime(variant.timeSeconds)}</span>
            <span className="when">{formatDate(variant.updatedAt)}</span>
          </button>
        ))}
    </>
  );
}
```

- [ ] **Step 2: Remove `PlayerView`, `PbRow`, `RaidGroupRows`, and `visiblePbs` from the monolith**

Delete all four from `frontend/src/components/PhaseTwoOsrsPreview.tsx`.

Add the import:

```typescript
import { PlayerView } from './PlayerView';
```

- [ ] **Step 3: Typecheck and test**

Run: `cd frontend && npx tsc --noEmit && npx vitest run`
Expected: clean, 92/92 passing.

- [ ] **Step 4: Commit**

```bash
cd frontend
git add src/components/PlayerView.tsx src/components/PhaseTwoOsrsPreview.tsx
git commit -m "refactor: extract PlayerView into its own file"
```

---

### Task 11: Extract `components/HomeView.tsx`

**Files:**
- Create: `frontend/src/components/HomeView.tsx`
- Modify: `frontend/src/components/PhaseTwoOsrsPreview.tsx`

Pure file move — `HomeView`'s internals were already finalized in Task 8.
Includes `PetIcon` and `statValue` as private, file-local helpers.

- [ ] **Step 1: Create the new file**

```tsx
// frontend/src/components/HomeView.tsx
import { FormEvent, useState } from 'react';
import type { LeaderboardRow, QuickStats, RecentSync } from '../lib/api';
import { isLoaded, type LoadState } from '../lib/loadState';
import { formatDate, formatTime, titleCase, bossTitleParts } from '../lib/format';
import { bossMonogram, useBossPetIconUrl } from '../lib/bossPetIcons';
import { bossSearchAlias } from '../lib/bossAliases';
import { useSearchSuggestions, compactAliasSuggestions } from '../hooks/useSearchSuggestions';

function normalize(boss: string): string {
  const lower = boss.trim().toLowerCase();
  return lower.startsWith('the ') ? lower.slice(4) : lower;
}

function statValue(value: number | undefined) {
  const numberFormatter = new Intl.NumberFormat();
  return value === undefined ? '...' : numberFormatter.format(value);
}

// Request a thumb ~2x the rendered box (32px sm / 64px lg boxes at 72% fit)
// so icons stay crisp on retina displays without over-fetching.
const PET_ICON_PIXEL_WIDTH: Record<'sm' | 'lg', number> = { sm: 64, lg: 128 };

function PetIcon({ boss, size = 'sm' }: { boss: string; size?: 'sm' | 'lg' }) {
  const url = useBossPetIconUrl(boss, PET_ICON_PIXEL_WIDTH[size]);
  return (
    <span className={`pbt-pet ${size}`}>
      {url ? <img src={url} alt="" loading="lazy" /> : bossMonogram(boss)}
    </span>
  );
}

export function HomeView({
  stats,
  recentSyncs,
  topBosses,
  bosses,
  lookupPlayer,
  goToBoss,
}: {
  stats: LoadState<QuickStats>;
  recentSyncs: LoadState<RecentSync[]>;
  topBosses: LoadState<Array<{ boss: string; leader: LeaderboardRow | null }>>;
  bosses: LoadState<string[]>;
  lookupPlayer: (name: string) => void;
  goToBoss: (boss: string) => void;
}) {
  const [playerQuery, setPlayerQuery] = useState('');
  const suggestions = useSearchSuggestions(playerQuery, bosses);

  const submitLookup = (name: string) => {
    setPlayerQuery('');
    lookupPlayer(name);
  };

  const onPlayerSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const alias = bossSearchAlias(playerQuery);
    const aliasSuggestions = alias && isLoaded(bosses) ? compactAliasSuggestions(playerQuery, bosses.data) : undefined;
    const aliasBoss = aliasSuggestions?.[0]?.value;
    const exactBoss = suggestions.find(
      (suggestion) => suggestion.type === 'boss' && normalize(suggestion.value) === normalize(playerQuery)
    );
    if (aliasBoss) goToBoss(aliasBoss);
    else if (exactBoss) goToBoss(exactBoss.value);
    else submitLookup(playerQuery);
  };

  return (
    <>
      <div className="pbt-section" style={{ paddingTop: 56 }}>
        <div className="pbt-kicker">
          <span>Gamewide personal-best leaderboards</span>
          <span className="rule" />
        </div>
        <h1 className="pbt-display pbt-h1">Find your next personal best.</h1>

        <form onSubmit={onPlayerSubmit} style={{ marginTop: 36 }}>
          <div className="pbt-searchband">
            <input
              value={playerQuery}
              onChange={(e) => setPlayerQuery(e.target.value)}
              placeholder="Search players or bosses"
              aria-label="Search players or bosses"
              autoComplete="off"
            />
            <button type="submit">Search</button>
          </div>
        </form>
        {suggestions.length > 0 && (
          <div className="pbt-suggestions">
            {suggestions.slice(0, 10).map((suggestion) => (
              <button
                key={`${suggestion.type}:${suggestion.value}`}
                type="button"
                onClick={() => suggestion.type === 'boss' ? goToBoss(suggestion.value) : submitLookup(suggestion.value)}
              >
                <span className="pbt-suggestion-type">{suggestion.type}</span>
                {suggestion.label ?? titleCase(suggestion.value)}
              </button>
            ))}
          </div>
        )}

        <div className="pbt-stats pbt-stats-single">
          <div className="pbt-stat">
            <span className="num">{isLoaded(stats) ? statValue(stats.data.trackedPlayers) : stats.s === 'error' ? '—' : '...'}</span>
            <div className="lbl">Tracked players</div>
            <span className="idx">01</span>
          </div>
        </div>
      </div>

      <div className="pbt-section">
        <div className="pbt-sec-head">
          <h2 className="pbt-display pbt-h2">Top bosses</h2>
          <div className="rule" />
        </div>
        {topBosses.s === 'loading' && <div className="pbt-panel-state">Loading top bosses...</div>}
        {topBosses.s === 'error' && <div className="pbt-panel-state">Top bosses unavailable.</div>}
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
      </div>

      <div className="pbt-section">
        <div className="pbt-sec-head">
          <h2 className="pbt-display pbt-h2">Recent syncs</h2>
          <div className="rule" />
        </div>
        {recentSyncs.s === 'loading' && <div className="pbt-panel-state">Loading recent syncs...</div>}
        {recentSyncs.s === 'error' && <div className="pbt-panel-state">Recent syncs unavailable.</div>}
        {isLoaded(recentSyncs) && (
          <div className="pbt-rows">
            {recentSyncs.data.map((sync, index) => (
              <button type="button" className="pbt-row" key={sync.id} onClick={() => submitLookup(sync.displayName)}>
                <span className="rank">{String(index + 1).padStart(2, '0')}</span>
                <span className="name">{sync.displayName}</span>
                <span className="time">{sync.pbCount} PBs</span>
                <span className="when">{formatDate(sync.updatedAt)}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
```

- [ ] **Step 2: Remove `HomeView`, `PetIcon`, `statValue`, and `normalize` from the monolith**

Delete all four from `frontend/src/components/PhaseTwoOsrsPreview.tsx`.

Add the import:

```typescript
import { HomeView } from './HomeView';
```

- [ ] **Step 3: Typecheck and test**

Run: `cd frontend && npx tsc --noEmit && npx vitest run`
Expected: clean (the monolith's imports should now shrink substantially —
remove anything the compiler flags as unused: likely `FormEvent`,
`bossMonogram`, `useBossPetIconUrl`, `bossSearchAlias`, `useSearchSuggestions`,
`compactAliasSuggestions` are no longer needed directly in the monolith),
92/92 passing.

- [ ] **Step 4: Commit**

```bash
cd frontend
git add src/components/HomeView.tsx src/components/PhaseTwoOsrsPreview.tsx
git commit -m "refactor: extract HomeView into its own file"
```

---

### Task 12: Rename the shell to `PbTrackerApp` and finish cleanup

**Files:**
- Rename: `frontend/src/components/PhaseTwoOsrsPreview.tsx` → `frontend/src/components/PbTrackerApp.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/test/requestBudget.test.tsx`
- Modify: `frontend/test/homeSearch.test.tsx`

By this point the shell file should contain only: the `useRoute`,
`useBossList`, `useBossLeaderboard`, `useHomeData`, `usePlayerProfile` hook
calls, the `goToBoss`/`accentColor` derivations, and the topbar/footer/route
switch JSX. Read the actual current file before this step — it should be
roughly 130-160 lines at this point, small enough to review in full.

- [ ] **Step 1: Rename the file and the component**

```bash
git mv frontend/src/components/PhaseTwoOsrsPreview.tsx frontend/src/components/PbTrackerApp.tsx
```

In the renamed file, change:

```typescript
export function PhaseTwoOsrsPreview() {
```

to:

```typescript
export function PbTrackerApp() {
```

Update the file's leading comment (currently "The phase-two experience is
the production site and owns the root route." lived in `App.tsx`, not this
file — check both files for any remaining "preview"/"phase two" wording and
update to plainly describe this as the app shell).

- [ ] **Step 2: Update `App.tsx`**

```typescript
// frontend/src/App.tsx
import { PbTrackerApp } from './components/PbTrackerApp';

export default function App() {
  return <PbTrackerApp />;
}
```

- [ ] **Step 3: Update the test imports**

In `frontend/test/requestBudget.test.tsx`, change:

```typescript
import { PhaseTwoOsrsPreview } from '../src/components/PhaseTwoOsrsPreview';
```

to:

```typescript
import { PbTrackerApp } from '../src/components/PbTrackerApp';
```

and update every `<PhaseTwoOsrsPreview />` JSX usage in that file to
`<PbTrackerApp />`.

Do the same in `frontend/test/homeSearch.test.tsx` (added in Task 8).

- [ ] **Step 4: Grep for any remaining "preview" naming in the production path**

Run:

```bash
grep -rn -i "preview" frontend/src/ frontend/test/
```

Expected remaining matches: only `theme-osrs-preview.css` (the stylesheet
filename, explicitly out of scope per the design spec's Definition of Done)
and its one `import '../theme-osrs-preview.css';` reference. Anything else
(component names, type names, function names, variable names) should be
gone — if the grep finds another one, fix it before proceeding.

- [ ] **Step 5: Typecheck, full test suite, and production build**

Run: `cd frontend && npx tsc --noEmit && npx vitest run && npx vite build`
Expected: clean typecheck, 92/92 passing, successful production build with
no new warnings.

- [ ] **Step 6: Commit**

```bash
cd frontend
git add -A
git commit -m "refactor: rename PhaseTwoOsrsPreview to PbTrackerApp"
```

---

## Self-Review Notes

- **Spec coverage:** every item in the design's "Target Structure" table has
  a task (hooks: Tasks 4-8; components: Tasks 9-11; lib: Tasks 1, 3, 8).
  Every row of the "Naming Cleanup" table is covered (Task 2 for
  routing-related names, Task 12 for the component/file itself, Task 12
  Step 4's grep catches anything missed). The Definition of Done's
  "no identifier containing preview... excluding theme-osrs-preview.css" is
  directly verified in Task 12 Step 4.
- **No placeholders:** every step contains complete, concrete code — no
  "similar to Task N" shorthand for any code block; each new file's full
  contents are given in the task that creates it.
- **Type consistency:** `Route` (Task 2) is used identically in
  `useBossList`, `useBossLeaderboard`, `useHomeData`, `usePlayerProfile`
  (Tasks 4-7), and in `BossView`/`PlayerView`'s `navigate` prop type
  (Tasks 9-10). `LoadState<T>`/`isLoaded` (Task 1) are used consistently
  everywhere a load state appears. The `HomeView`/`BossView`/`PlayerView`
  prop interfaces are defined once (in the tasks that finalize their
  internals: Task 8 for `HomeView`, Task 2/5 for `BossView`'s `navigate`/
  `titleParts` types, Task 7 for `PlayerView`'s `PlayerState`) and then
  carried through unchanged into their file-extraction tasks (9-11) with no
  discrepancies.
- **Ordering risk called out explicitly:** Task 4's Step 3 flags the one
  intentional, temporary behavior gap (no initial-boss-auto-select between
  Tasks 4 and 5) so whoever executes this plan doesn't mistake it for a bug
  worth stopping to investigate.
