# PbTrackerApp Decomposition

**Status:** Approved direction; ready for implementation planning

**Date:** 2026-07-26

**Repository:** `0xJeu/osrs-pb-tracker`, `frontend/`

## Summary

`frontend/src/components/PhaseTwoOsrsPreview.tsx` is the entire production
website in one 829-line file: `App.tsx` renders it directly as the app root.
Despite the name, it is not a preview — it owns routing, every data-fetching
effect for every page, and the rendering for the home, boss-leaderboard, and
player-profile views, plus several small leaf components. The name persists
from however the "phase two" rebuild originally shipped as final, and it has
become misleading: recent unrelated fixes (view-scoped fetching, search
controls) all had to land in this one file because there was nowhere else to
put page-level logic.

This design splits the file into three layers — routing/data hooks, view
components, and pure helpers — with no behavior change. It also finishes a
naming cleanup so "preview" language no longer appears anywhere in the
production code path.

## Goals

- Break `PhaseTwoOsrsPreview.tsx` into per-view components, each independently
  readable and testable.
- Extract each view's data-fetching logic into a named custom hook, so the
  file that used to hold every `useEffect` for every page no longer does.
- Rename the shell component and every "preview"-named identifier so nothing
  in the production render path still says "preview."
- Preserve existing behavior exactly — this is a structural refactor, not a
  feature change.

## Non-Goals

- No new features, no visual changes, no new API calls.
- No change to `frontend/src/lib/api.ts` beyond what's already landed
  (the fetch-injection-seam fix, commit `25ea37e`, is treated as baseline).
- No re-architecting of state management (e.g. no Redux/Zustand/context
  introduced) — the shell continues to own cross-view state and pass it down
  as props, matching the codebase's existing conventions.
- Not a testing-strategy overhaul beyond updating the one import path that
  changes (`requestBudget.test.tsx`).

## Current Structure (for reference)

`PhaseTwoOsrsPreview.tsx` today contains, in one file:

- Shared types: `LoadState<T>`, `PlayerState`, `PreviewView`, `BossRecordSort`,
  `SortDirection`.
- Pure helpers: `normalize`, `viewFromPreviewPath`, `isLoaded`,
  `pickInitialBoss`, `bossTitleParts`, `statValue`, `visiblePbs`,
  `compactAliasSuggestions`.
- A small leaf component: `PetIcon`.
- The top-level `PhaseTwoOsrsPreview` component: owns `view` state, the
  `popstate` listener, `navigate()`, six-plus `useEffect`s (boss list, stats,
  recent syncs, top-bosses overview, leaderboard page, player profile,
  search suggestions), and renders the topbar/footer/route switch.
- `HomeView`, `BossView`, `PlayerView` (plus `PlayerView`'s private
  `PbRow`/`RaidGroupRows` sub-components) — all rendering, receiving
  everything as props from the shell.

## Target Structure

### `hooks/` (new directory)

| File | Owns | Gated on |
|---|---|---|
| `useRoute.ts` | The `Route` type (renamed from `PreviewView`), `routeFromPath()` (renamed from `viewFromPreviewPath`), the `popstate` listener, `navigate()`. Returns `{ route, navigate }`. | Always active — pure routing, no fetching. |
| `useBossList.ts` | Fetches `/api/bosses` once. Shared by Home (alias-suggestion resolution) and Boss (combobox/picker). Returns `LoadState<string[]>`. | `route.name === 'home' \|\| 'boss'` |
| `useHomeData.ts` | `stats`, `recentSyncs`, `topBosses` (the leaderboard-overview call). | `route.name === 'home'` |
| `useBossLeaderboard.ts` | `selectedBoss`, `leaderboardOffset`, the leaderboard-page fetch, derived `titleParts`/`highlight`. Takes `route` and the boss list as input (needs the list to pick an initial boss on first load). Returns everything `BossView` needs, plus `selectedBoss` for the shell's nav-button fallback. | `route.name === 'boss'` for the fetch; `selectedBoss` itself is readable from any route (used by the topbar). |
| `usePlayerProfile.ts` | The player-lookup fetch and `profileState`. | `route.name === 'player'` |
| `useSearchSuggestions.ts` | The debounced search-as-you-type logic (currently tangled into the shell). Called from inside `HomeView`, since nothing else uses it. | Called only from `HomeView`; internally still guards on query length. |

Each hook internally reproduces the same idle/loading/loaded/error-state and
`alive`-flag-cleanup pattern the current effects already use — this is a
relocation, not a rewrite of the gating logic.

### `components/`

| File | Contents |
|---|---|
| `PbTrackerApp.tsx` (renamed from `PhaseTwoOsrsPreview.tsx`) | Calls the hooks above, renders topbar/footer, switches on `route.name` to render `HomeView` / `BossView` / `PlayerView` / the existing static pages (`AboutPage`, `FaqPage`, `SetupGuidePage`, unchanged). |
| `HomeView.tsx` | Rendering plus **newly-local** `playerQuery` state, `onPlayerSubmit`/alias-detection logic, and the `useSearchSuggestions` call — these only ever affected Home and lived in the shell purely because the shell used to hold all state. Includes `PetIcon` and `statValue` as private, file-local helpers (not split into their own files, matching their single-use, small-size profile). |
| `BossView.tsx` | Same rendering as today, now takes hook output as props instead of shell-local state. |
| `PlayerView.tsx` | Same rendering as today, including `PbRow` and `RaidGroupRows` as private sub-components in the same file (single-use, small). |

### `lib/`

- `LoadState<T>` and `isLoaded()` move to a shared module (e.g.
  `lib/loadState.ts`) since every new hook needs them.
- Other pure helpers move to wherever they're actually used rather than into
  one new catch-all file: `normalize`/`compactAliasSuggestions` near the
  search logic, `bossTitleParts`/`pickInitialBoss` into
  `useBossLeaderboard.ts`, `visiblePbs` into `PlayerView.tsx`. Exact
  file-by-file placement is an implementation-plan-level detail.

## Naming Cleanup

Every "preview"-prefixed identifier in the production path is renamed as part
of this change, since the naming is what caused the confusion this design
exists to fix:

| Before | After |
|---|---|
| `PhaseTwoOsrsPreview` (component + file) | `PbTrackerApp` |
| `PreviewView` (type) | `Route` |
| `previewBase` (constant) | Deleted. It's a hardcoded `''` literal (not derived from config/environment — confirmed via `frontend/src/components/PhaseTwoOsrsPreview.tsx:39`), and its own existing comment says the app "owns the production root route." Every call site (`${previewBase}/player/...`, etc.) simplifies by dropping the interpolation. |
| `viewFromPreviewPath()` | `routeFromPath()` |

`App.tsx`'s import updates accordingly. No other files reference
`PhaseTwoOsrsPreview` except `frontend/test/requestBudget.test.tsx`, which
needs its import path updated as part of this change.

## Data Flow

No behavioral change from today: the shell still coordinates state that
genuinely spans views (route, boss list, selected boss) and passes it down as
props; the difference is *where* that coordination logic lives (named hooks
instead of inline effects in one file) and that view-private state (search
box text, sort order) moves down into the view that actually owns it and
never needed to live in the shell.

## Testing Impact

Pure refactor — no new test scenarios required. Existing tests continue to
assert the same behavior:

- `frontend/test/requestBudget.test.tsx` — update the import from
  `PhaseTwoOsrsPreview` to `PbTrackerApp`'s new path. As of commit `25ea37e`
  (already landed on this branch), this test uses a plain static import and
  `vi.stubGlobal('fetch', ...)` — no dynamic-import workaround to carry
  forward, so this is a one-line change.
- All other existing frontend tests (`api.test.ts`, `format.test.ts`,
  `bossGroups.test.ts`, etc.) are unaffected — they don't import from the
  file being split.
- No new test files are required by this design, though the implementation
  plan may choose to add small hook-level tests (e.g. for `useRoute.ts`'s
  `routeFromPath()`) if doing so is cheap given the extraction — that's an
  implementation-plan-level decision, not required by this spec.

## Error Handling

Unchanged. Existing error states (`LoadState`'s `'error'` variant, the
per-view fallback messages like "Top bosses unavailable.") carry over as-is,
just relocated into their respective hooks/views.

## Rollout

Stacked on top of PR #27 rather than sequenced after it: branch from
`frontend-view-scoped-fetching` (PR #27's branch) instead of `dev`, so this
work starts from the exact code state #27 already introduced (including the
`useEffect`-per-view split and the `25ea37e` fetch-injection-seam fix) and
never conflicts with it. Open the PR with base `frontend-view-scoped-fetching`
rather than `dev`. Once #27 merges into `dev` and its branch is deleted,
GitHub automatically retargets this PR's base to `dev` — no manual rebase
needed. This also means this PR's diff, as shown on GitHub, is exactly the
decomposition changes, not the view-scoped-fetching changes it builds on.

## Definition of Done

- `PhaseTwoOsrsPreview.tsx` no longer exists; `PbTrackerApp.tsx` replaces it.
- `App.tsx` renders `PbTrackerApp`.
- No identifier containing "preview" remains in `frontend/src/` (excluding
  unrelated files like `theme-osrs-preview.css`, which is out of scope).
- `HomeView.tsx`, `BossView.tsx`, `PlayerView.tsx` exist as separate files
  under `components/`.
- `hooks/useRoute.ts`, `useBossList.ts`, `useHomeData.ts`,
  `useBossLeaderboard.ts`, `usePlayerProfile.ts`, `useSearchSuggestions.ts`
  exist.
- `npm run build` and `npm test` pass with no behavioral changes (same
  assertions passing as before, only import paths updated where needed).
