# Selective Sync Invalidation + Exact Profile Dependency Tags Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implements Workstreams F ("Selective Sync Invalidation") and G ("Exact Profile Dependency Tags") of `docs/superpowers/specs/2026-07-24-neon-compute-wake-reduction-design.md`.

**Repository Note (read this before starting):** CDN cache-tag infrastructure (`backend-hono/src/lib/cache.ts`, sync-triggered invalidation in `backend-hono/src/routes/sync.ts`, and the 32-bucket profile dependency scheme) **already exists in production** on `fork/dev`/`fork/main` — it was NOT built by this plan. This was discovered by reading the actual current `fork/dev` state directly (a stale local checkout had previously and incorrectly suggested none of this existed). This plan is a **surgical fix**, not new infrastructure: it corrects two specific over-invalidation gaps (F) and replaces the existing bucket-only profile tagging with exact tags plus a bucket fallback (G).

**Current state, verified against `fork/dev` (2026-07-28):**
- `stats` is invalidated on every changed boss, including a pure faster-time improvement with no inserted row. Spec requires stats to change only on insert, not on improvement.
- `bossList`/`search` are invalidated on every changed boss, regardless of whether that boss key is new to the whole database. Spec requires this only for a boss's first-ever appearance.
- `upsertPbs` (in `sync.ts`) returns which bosses changed, but not whether each was an insert or an improvement — there is currently no way to apply either rule above.
- Player profile responses (`players.ts`) are tagged only with the 32 `profile-boss-bucket:<0-31>` tags (via `profileBossBucketCacheTag`) — no exact per-boss tag exists yet.
- `test/cache.test.ts` covers the existing tag-generation helpers and `invalidateSharedCache`, but nothing in `test/sync.test.ts` currently asserts on invalidation-tag contents for any event type (grepped: only one unrelated `cdn-cache-control` header assertion).

**Architecture:** Extend `backend-hono/src/lib/cache.ts` with an exact per-boss profile tag function and a threshold helper; use Postgres's `xmax = 0` RETURNING trick in `upsertPbs`'s existing single upsert statement to classify each changed boss as inserted vs. improved, in the same query (no extra round trip); add one bounded follow-up query (over only the inserted boss keys, not the whole boss table) to detect which inserted bosses are globally new to the database; update `sync.ts`'s invalidation-tag assembly to apply the corrected truth table; update `players.ts`'s `profileCacheTags` to emit exact tags below the 126-PB threshold and bucket tags at or above it, invalidating both exact and bucket tags in `sync.ts` for rolling-deploy safety per the spec.

**Tech Stack:** TypeScript, Hono, Drizzle ORM, Neon Postgres, Vitest. Tests run against the real Neon `test` branch via `.env.test` (already present in this worktree, copied from the main checkout — gitignored, do not commit it).

**Before starting:**
```bash
cd "OSRS Stuff/worktrees/osrs-pb-tracker-selective-invalidation/backend-hono"
npm run typecheck   # should pass clean
npm test            # should show 90 passed (90) as of this plan's baseline
```
All file paths below are relative to `backend-hono/` in that worktree.

---

### Task 1: Distinguish inserted vs. improved bosses in `upsertPbs`

**Files:**
- Modify: `src/routes/sync.ts`
- Test: `test/sync.test.ts`

**Current code** (`upsertPbs`, in `src/routes/sync.ts`):

```typescript
async function upsertPbs(playerId: number, pbsByBoss: Map<string, number>) {
  if (pbsByBoss.size === 0) {
    return [] as string[];
  }

  const updatedAt = new Date();
  const changed = await db
    .insert(personalBests)
    .values(
      Array.from(pbsByBoss, ([boss, timeSeconds]) => ({
        playerId,
        boss,
        timeSeconds,
        updatedAt,
      }))
    )
    .onConflictDoUpdate({
      target: [personalBests.playerId, personalBests.boss],
      set: { timeSeconds: sql`excluded.time_seconds`, updatedAt },
      setWhere: sql`excluded.time_seconds < ${personalBests.timeSeconds}`,
    })
    .returning({ boss: personalBests.boss });

  return [...new Set(changed.map((row) => row.boss))];
}
```

- [ ] **Step 1: Write the failing test**

Add to `test/sync.test.ts` (check the existing file's imports/setup pattern first — it already uses `app.request(...)`, `truncateAll()`, a `syncPlayer` or equivalent helper; match that style exactly rather than the illustrative shape below):

```typescript
describe('POST /api/sync - insert vs improvement classification', () => {
  it('invalidates stats on a brand new PB but not on a faster-time-only improvement', async () => {
    const syncMock = vi.spyOn(cacheModule, 'invalidateSharedCache');
    // ... sync a first PB for zulrah (insert) - expect syncMock's most recent call to include cacheTags.stats
    // ... sync a strictly faster time for the same zulrah PB (improvement only) - expect syncMock's most recent call to NOT include cacheTags.stats
  });
});
```

Adapt this to actually match how `test/cache.test.ts` mocks `@vercel/functions`' `invalidateByTag` (via `vi.hoisted`) — the cleanest approach is very likely to mock `@vercel/functions`' `invalidateByTag` the same way `cache.test.ts` does, call the real `/api/sync` route via `app.request(...)`, and assert on what tags `invalidateByTag` was called with, rather than mocking `invalidateSharedCache` itself (mocking your own module under test is usually the wrong seam - mock the external boundary `@vercel/functions` instead, exactly like `cache.test.ts` already does). Set `process.env.VERCEL = '1'` for the duration of the test (see `cache.test.ts`'s `beforeEach`/`afterEach` pattern for restoring it) since `invalidateSharedCache` no-ops without it.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- sync.test.ts`
Expected: FAIL — the new assertion about `stats` not being invalidated on a pure improvement will fail, since current code invalidates `stats` for any changed boss.

- [ ] **Step 3: Write the implementation**

Change `upsertPbs` to classify each changed boss as inserted or improved using Postgres's `xmax = 0` trick (a row's `xmax` system column is `0` if the row was inserted by the current command, non-zero if it was updated) — this works within the existing single `INSERT ... ON CONFLICT ... DO UPDATE ... RETURNING` statement, no extra query needed for this part:

```typescript
async function upsertPbs(playerId: number, pbsByBoss: Map<string, number>) {
  if (pbsByBoss.size === 0) {
    return { insertedBosses: [] as string[], improvedBosses: [] as string[] };
  }

  const updatedAt = new Date();
  const changed = await db
    .insert(personalBests)
    .values(
      Array.from(pbsByBoss, ([boss, timeSeconds]) => ({
        playerId,
        boss,
        timeSeconds,
        updatedAt,
      }))
    )
    .onConflictDoUpdate({
      target: [personalBests.playerId, personalBests.boss],
      set: { timeSeconds: sql`excluded.time_seconds`, updatedAt },
      setWhere: sql`excluded.time_seconds < ${personalBests.timeSeconds}`,
    })
    .returning({
      boss: personalBests.boss,
      inserted: sql<boolean>`xmax = 0`,
    });

  const insertedBosses = new Set<string>();
  const improvedBosses = new Set<string>();
  for (const row of changed) {
    (row.inserted ? insertedBosses : improvedBosses).add(row.boss);
  }

  return {
    insertedBosses: [...insertedBosses],
    improvedBosses: [...improvedBosses],
  };
}
```

Note: `xmax` is a system column, not a normal table column - `sql<boolean>`xmax = 0`` refers to it directly on the target table (`personal_bests`), which is valid inside a `RETURNING` clause of an `INSERT ... ON CONFLICT DO UPDATE` in PostgreSQL. Confirm this returns real booleans (not `'t'`/`'f'` strings) against the actual Neon Postgres version this project runs — if Drizzle/node-postgres returns a string instead of a JS boolean here, adjust the type accordingly (this is exactly the kind of thing the spec's "tested against the production PostgreSQL version" caution is about) and add a small assertion of this in the test from Step 1.

- [ ] **Step 4: Update the caller in `sync.post('/', ...)`**

The route handler currently does:
```typescript
const changedBosses = await upsertPbs(playerId, pbsByBoss);
const meaningfulChange = created || metadataChanged || changedBosses.length > 0;
const syncAttemptId = meaningfulChange
  ? await recordSyncAttempt({
      playerId,
      outcome: 'accepted',
      httpStatus: 200,
      receivedCount: entries.length,
      eligibleCount: pbsByBoss.size,
      updatedCount: changedBosses.length,
    })
  : null;
```
and later:
```typescript
if (changedBosses.length > 0) {
  invalidationTags.push(
    cacheTags.bossList,
    cacheTags.search,
    cacheTags.stats,
    playerIdCacheTag(playerId),
    ...changedBosses.flatMap((boss) => [bossCacheTag(boss), profileBossBucketCacheTag(boss)])
  );
}
```
and the final response:
```typescript
return c.json({
  ok: true,
  playerId,
  received: entries.length,
  updated: changedBosses.length,
  syncAttemptId,
});
```

Update all three spots to work off `{ insertedBosses, improvedBosses }` instead of a flat `changedBosses` array. Introduce a local `const changedBosses = [...insertedBosses, ...improvedBosses];` right after calling `upsertPbs` so `meaningfulChange`, `recordSyncAttempt`'s `updatedCount`, and the response's `updated` field keep exactly their current behavior and shape (these are observable API/plugin-facing fields — **do not change their meaning or the response shape**, only the invalidation-tag logic changes in this task). Task 2 (below) changes what gets pushed into `invalidationTags` for the `changedBosses.length > 0` block; don't do that part yet in this task — Task 1 is scoped to only the classification plumbing (introducing `insertedBosses`/`improvedBosses` and threading them through), not the invalidation-rule change itself. Confirm this by re-reading Task 2 before finishing this task, so the two tasks don't overlap.

- [ ] **Step 5: Run tests to verify Task 1's specific test passes**

Run: `npm test -- sync.test.ts`
Expected: the classification-related assertions from Step 1 should now be verifiable in principle, but the actual invalidation-rule fix happens in Task 2 - if Step 1's test also asserts on the `stats` tag being absent on improvement, it will still fail until Task 2 lands. If so, it's fine for this task's own narrower test (just proving `insertedBosses`/`improvedBosses` are computed correctly, e.g. via a unit-level test or by checking `syncAttemptId`'s `updatedCount` still matches the total count) to pass now, with the tag-content assertion deferred to Task 2's test. Use your judgment on how to split this cleanly; document the split in your commit message if you adjust the Step 1 test's scope.

- [ ] **Step 6: Run the full test suite**

Run: `npm test`
Expected: all existing tests still pass (the response shape and `updated` count are unchanged - only pushed as insertedBosses+improvedBosses concatenated back to `changedBosses.length`).

- [ ] **Step 7: Commit**

```bash
git add src/routes/sync.ts test/sync.test.ts
git commit -m "refactor: classify synced PBs as inserted vs improved"
```

---

### Task 2: Only invalidate `stats`/`bossList`/`search` when the truth table actually requires it

**Files:**
- Modify: `src/routes/sync.ts`

Per the spec's invalidation truth table:
- `stats` changes for a new player **or PB insertion**, not for a faster-time update alone.
- `bossList` changes **only** when the first-ever PB for a previously-absent boss key is inserted.
- `search` changes for a new player, rename, **or first-ever boss key** — not for a known player's faster time.
- Boss leaderboards and rank-bearing player profiles (the per-boss/profile tags) change for **both** insertion and improvement.

- [ ] **Step 1: Write the failing tests**

Add to `test/sync.test.ts` (following the mocking approach established in Task 1):
- A sync introducing a brand-new boss key (one that has never appeared in `personal_bests` for ANY player) invalidates `bossList` and `search`, in addition to `stats` and the per-boss/profile tags.
- A sync improving an existing boss's time for a player, where that boss key is already used by other players (not globally new), does NOT invalidate `bossList` or `search` or `stats` - only the per-boss/profile/player-id tags.
- A sync inserting a *new* PB for a boss that is NOT globally new (i.e., other players already have that boss key, this is just this player's first time) invalidates `stats` (insertion) and the per-boss/profile tags, but NOT `bossList`/`search` (not globally new).

You'll need a way to seed "this boss key already exists for another player" in the test setup - look at how other tests in this file seed multiple players/syncs (likely a helper that POSTs to `/api/sync` for a given account/name/pbs, called multiple times with different accounts).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- sync.test.ts`
Expected: FAIL - current code invalidates `bossList`/`search`/`stats` unconditionally for any changed boss.

- [ ] **Step 3: Add the "is this boss key globally new" query**

Add a helper, called only with the set of **inserted** boss keys (never the full boss table, never per-PB):

```typescript
// Bounded to only the boss keys this sync just inserted - never scans the
// full personal_bests table. A boss is "globally new" if, after this
// insert, exactly one row anywhere in the database has that boss key (this
// player's own just-inserted row).
async function findGloballyNewBosses(insertedBosses: readonly string[]): Promise<Set<string>> {
  if (insertedBosses.length === 0) {
    return new Set();
  }

  const counts = await db
    .select({ boss: personalBests.boss, count: sql<number>`count(*)` })
    .from(personalBests)
    .where(inArray(personalBests.boss, insertedBosses))
    .groupBy(personalBests.boss);

  const globallyNew = new Set<string>();
  for (const row of counts) {
    if (Number(row.count) === 1) {
      globallyNew.add(row.boss);
    }
  }
  return globallyNew;
}
```

Add `inArray` to the existing `drizzle-orm` import at the top of the file (alongside `eq`, `lt`, `sql`).

Call this once, right after `upsertPbs` resolves, passing only `insertedBosses` (not `improvedBosses` - an improvement can never be "first-ever," since a row with that boss key already existed before the improvement happened).

- [ ] **Step 4: Update the invalidation-tag assembly**

Replace the current `if (changedBosses.length > 0) { ... }` block with:

```typescript
const anyInsertedOrImproved = insertedBosses.length > 0 || improvedBosses.length > 0;

if (insertedBosses.length > 0) {
  invalidationTags.push(cacheTags.stats);
}

if (globallyNewBosses.size > 0) {
  invalidationTags.push(cacheTags.bossList, cacheTags.search);
}

if (anyInsertedOrImproved) {
  invalidationTags.push(
    playerIdCacheTag(playerId),
    ...[...insertedBosses, ...improvedBosses].flatMap((boss) => [
      bossCacheTag(boss),
      profileBossBucketCacheTag(boss),
    ])
  );
}
```

(Note: `profileBossBucketCacheTag` here will be joined by an exact-tag equivalent in Task 5 - don't add that yet, this task is scoped to the F truth-table fix only.)

Double check this doesn't change behavior for the `metadataChanged`/`created` blocks above it in the function - those are untouched by this task.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- sync.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: all tests pass, including Task 1's tests and everything pre-existing.

- [ ] **Step 7: Commit**

```bash
git add src/routes/sync.ts test/sync.test.ts
git commit -m "fix: only invalidate stats/boss-list/search when the sync truth table requires it"
```

---

### Task 3: Exact per-boss profile dependency tag + threshold helper

**Files:**
- Modify: `src/lib/cache.ts`
- Test: `test/cache.test.ts`

**Current code** (`src/lib/cache.ts`, existing bucket function for reference/style):

```typescript
export function profileBossBucketCacheTag(boss: string) {
  // A response may eventually contain more PBs than Vercel's 128-tag limit.
  // Bucketed dependency tags keep every player profile well below that cap
  // while invalidating only a small subset of profiles for a changed boss.
  let hash = 2166136261;
  for (const character of boss.trim().toLowerCase()) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `profile-boss-bucket:${(hash >>> 0) % 32}`;
}
```

- [ ] **Step 1: Write the failing tests**

Add to `test/cache.test.ts`:

```typescript
it('builds an exact per-boss profile dependency tag', () => {
  expect(profileBossExactCacheTag('Zulrah')).toBe('profile-boss:zulrah');
  expect(profileBossExactCacheTag(' ZULRAH ')).toBe(profileBossExactCacheTag('zulrah'));
});

it('reports whether a profile fits under the exact-tag threshold', () => {
  // Name route reserves 2 tag slots (player-name + the exact/bucket tags
  // themselves don't need reservation beyond this - see design doc "the
  // name route must reserve two tag slots, so exact tags are used only
  // when the profile has at most 126 PBs").
  expect(fitsExactProfileTags(126)).toBe(true);
  expect(fitsExactProfileTags(127)).toBe(false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- cache.test.ts`
Expected: FAIL - `profileBossExactCacheTag`/`fitsExactProfileTags` don't exist yet.

- [ ] **Step 3: Write the implementation**

Add to `src/lib/cache.ts`, near `profileBossBucketCacheTag`:

```typescript
// 126 PBs is the current safe ceiling: the by-id route needs 1 reserved
// slot (player-id) and the name route needs 2 (player-name + player-id),
// so reserving 2 out of Vercel's 128-tag cap keeps both routes safely under
// the limit at the same threshold. Production's current maximum is 125 PBs
// (see the design doc's evidence section), so every real profile fits today.
const MAX_EXACT_PROFILE_TAGS = MAX_CACHE_TAGS - 2;

export function profileBossExactCacheTag(boss: string) {
  return `profile-boss:${tagPart(boss)}`;
}

export function fitsExactProfileTags(pbCount: number) {
  return pbCount <= MAX_EXACT_PROFILE_TAGS;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- cache.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full suite**

Run: `npm test`

- [ ] **Step 6: Commit**

```bash
git add src/lib/cache.ts test/cache.test.ts
git commit -m "feat: add exact per-boss profile cache tag and threshold helper"
```

---

### Task 4: Use exact tags (with bucket fallback) on the player profile routes

**Files:**
- Modify: `src/routes/players.ts`
- Test: `test/players.test.ts`

**Current code** (`src/routes/players.ts`):

```typescript
import {
  cachePolicies,
  playerIdCacheTag,
  playerNameCacheTag,
  profileBossBucketCacheTag,
  setSharedCache,
} from '../lib/cache.js';

// ...

function profileCacheTags(payload: Awaited<ReturnType<typeof playerWithPbs>>) {
  return [
    playerIdCacheTag(payload.id),
    ...payload.pbs.map((pb) => profileBossBucketCacheTag(pb.boss)),
  ];
}
```

- [ ] **Step 1: Write the failing tests**

Add to `test/players.test.ts`:
- A profile with a normal (small) number of PBs gets tagged with exact `profile-boss:<boss>` tags for each PB (assert on the `vercel-cache-tag` response header, splitting on comma, checking it contains `profile-boss:<eachboss>` for every synced boss).
- A profile response's total tag count for a normal-sized profile stays well under 128.
- (Deferred to Task 6 for the full 125/126/127-PB boundary tests, which need bulk PB seeding - this task's tests just need to prove the exact-tag path is wired up correctly for the common case.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- players.test.ts`
Expected: FAIL - current code only emits bucket tags, never exact tags.

- [ ] **Step 3: Write the implementation**

```typescript
import {
  cachePolicies,
  fitsExactProfileTags,
  playerIdCacheTag,
  playerNameCacheTag,
  profileBossBucketCacheTag,
  profileBossExactCacheTag,
  setSharedCache,
} from '../lib/cache.js';

// ...

function profileCacheTags(payload: Awaited<ReturnType<typeof playerWithPbs>>) {
  const bossDependencyTags = fitsExactProfileTags(payload.pbs.length)
    ? payload.pbs.map((pb) => profileBossExactCacheTag(pb.boss))
    : payload.pbs.map((pb) => profileBossBucketCacheTag(pb.boss));

  return [playerIdCacheTag(payload.id), ...bossDependencyTags];
}
```

Leave everything else in `players.ts` (the `/by-id/:id` and `/:name` handlers, the ambiguous-match branch) untouched - `profileCacheTags` is the only function this task changes.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- players.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full suite**

Run: `npm test`

- [ ] **Step 6: Commit**

```bash
git add src/routes/players.ts test/players.test.ts
git commit -m "feat: use exact profile-boss cache tags below the 126-PB threshold"
```

---

### Task 5: Invalidate both exact and bucket tags on a boss change

**Files:**
- Modify: `src/routes/sync.ts`
- Test: `test/sync.test.ts`

Per the spec: *"When a boss changes, invalidate both: its exact `profile-boss` tag; its legacy/fallback bucket tag. Invalidating both keeps exact-tag and fallback responses correct during rolling deployments and for oversized future profiles."*

This is needed because during a rolling deploy (some serverless instances running old code, some running new code) or for any profile still using the bucket fallback, only invalidating one of the two tag schemes could leave a stale cached response depending on which scheme actually tagged it.

- [ ] **Step 1: Write the failing test**

Add to `test/sync.test.ts`: a sync that changes a boss's time invalidates BOTH `profile-boss:<boss>` (exact) and `profile-boss-bucket:<N>` (bucket, computed the same way `profileBossBucketCacheTag` would) for that boss - assert both tag strings appear in the `invalidateByTag` mock call.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- sync.test.ts`
Expected: FAIL - current code (after Task 2) only pushes `profileBossBucketCacheTag`, not the exact-tag equivalent.

- [ ] **Step 3: Write the implementation**

In `src/routes/sync.ts`, update the import to add `profileBossExactCacheTag`, and update the `anyInsertedOrImproved` block from Task 2:

```typescript
if (anyInsertedOrImproved) {
  invalidationTags.push(
    playerIdCacheTag(playerId),
    ...[...insertedBosses, ...improvedBosses].flatMap((boss) => [
      bossCacheTag(boss),
      profileBossExactCacheTag(boss),
      profileBossBucketCacheTag(boss),
    ])
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- sync.test.ts`

- [ ] **Step 5: Run the full suite**

Run: `npm test`

- [ ] **Step 6: Commit**

```bash
git add src/routes/sync.ts test/sync.test.ts
git commit -m "fix: invalidate both exact and bucket profile tags on a boss change"
```

---

### Task 6: Boundary tests for the 126-PB exact/fallback threshold

**Files:**
- Test: `test/players.test.ts` (or a new `test/cacheThreshold.test.ts` if seeding 125+ PBs makes more sense as a focused file - use your judgment, but don't duplicate the whole players.ts test setup unnecessarily)

This task has no production code changes - Tasks 3 and 4 already implement the threshold logic. This task is pure verification that the boundary behaves exactly as specified, matching the spec's explicit validation requirements:

- [ ] **Step 1: A 125-PB player-name response stays below 128 unique tags**

Seed a player with 125 distinct tracked-boss PBs (check `src/lib/trackedBosses.ts` for the real list of valid boss keys - you need 125 distinct real ones, or confirm whether the tracked-boss allowlist actually has ≥125 entries; if it doesn't, note this in your report rather than seeding invalid/fake boss keys that `isTrackedBoss` would reject during sync). GET `/api/players/:name`, count unique tags in the `vercel-cache-tag` header, assert < 128.

- [ ] **Step 2: A 126-PB response reaches but does not exceed the limit**

Same, with 126 PBs. Assert the tag count is <= 128 (should land at exactly `126 + 2 = 128` for the name route: player-name tag + player-id tag + 126 exact boss tags).

- [ ] **Step 3: A 127-PB response uses the bucket fallback, not truncation**

Same, with 127 PBs. Assert the response's `vercel-cache-tag` header contains `profile-boss-bucket:` tags, NOT `profile-boss:` exact tags, for this profile - and assert no tags were silently dropped/truncated (i.e., the response doesn't just cap at 128 real per-boss tags and drop the rest; it switches schemes entirely, per `fitsExactProfileTags`'s all-or-nothing behavior from Task 3).

- [ ] **Step 4: Changing one boss invalidates both exact and fallback dependencies**

Already covered by Task 5's test - if there's overlap, don't duplicate; just confirm Task 5's test exists and covers this, and cross-reference it in this task's section instead of re-writing it.

- [ ] **Step 5: No player-name or player-ID invalidation is lost**

Confirm (via an existing or new assertion) that `playerIdCacheTag`/`playerNameCacheTag` are still present in the invalidation tags regardless of whether the profile uses exact or bucket tags - this should already be true from Task 2's `anyInsertedOrImproved` block always pushing `playerIdCacheTag(playerId)`, but verify explicitly with a test using a 127+-PB (bucket-fallback) profile specifically, since that's the case most likely to have been broken by an incomplete Task 4/5 implementation.

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: all tests pass, including all 5 tasks' new tests plus every pre-existing test.

- [ ] **Step 7: Typecheck and commit**

```bash
npm run typecheck
git add test/
git commit -m "test: verify the 125/126/127-PB exact-tag threshold boundary"
```

---

### Task 7: Full validation and PR

**Files:** none (verification only)

- [ ] **Step 1: Run the full required test/build suite**

```bash
npm run typecheck
npm test
```
Expected: both clean.

- [ ] **Step 2: Manual sanity check against the truth table**

Re-read the spec's "Invalidation truth table" section (`docs/superpowers/specs/2026-07-24-neon-compute-wake-reduction-design.md`, Workstream F) and confirm each row is now actually satisfied by the final code, not just by the tests you wrote - a whole-branch review should re-verify this independently rather than trust task-level review alone, given how many previous plans in this project found real bugs after all individual tasks passed review.

- [ ] **Step 3: Push and open a PR against `dev`**

```bash
git push -u fork selective-sync-invalidation
gh pr create --repo 0xJeu/osrs-pb-tracker --base dev --title "Selective sync invalidation and exact profile dependency tags" --body "Implements Workstreams F and G of docs/superpowers/specs/2026-07-24-neon-compute-wake-reduction-design.md. Corrects two over-invalidation gaps in the existing cache-tag infrastructure (stats invalidated on every boss change instead of only insertions; boss-list/search invalidated on every boss change instead of only a boss's first-ever appearance) and replaces the profile route's bucket-only tagging with exact per-boss tags below a 126-PB threshold, falling back to the existing 32-bucket scheme above it, invalidating both schemes on every boss change for rolling-deploy safety."
```

---

## Self-Review Notes

- **Spec coverage:** Truth-table rows for unchanged sync, new player, rename, and install-secret-only were already correctly handled by the existing code and are untouched by this plan. This plan closes the remaining two rows (insertion-only stats, first-ever-boss-only bossList/search) and implements G's exact-tag/threshold/dual-invalidation requirements in full.
- **No placeholders:** all steps contain complete code, adapted to the actual current file contents (verified by reading `fork/dev` directly, not a stale local checkout).
- **Explicitly NOT in scope:** Workstream I (profile rank query follow-up) is deliberately deferred per the spec's own rollout plan (Phase 4, requires 48h-7 days of production measurement after this ships). Workstream J (no hidden keepalive) is an invariant to audit, not a build task, and this plan introduces no new keepalive behavior.
- **Risk called out for implementers:** the `xmax = 0` RETURNING trick (Task 1) is a well-established Postgres pattern but must be verified against this project's actual Neon Postgres version and Drizzle's exact type mapping for the returned boolean - do not assume it "just works" without running the real test.
