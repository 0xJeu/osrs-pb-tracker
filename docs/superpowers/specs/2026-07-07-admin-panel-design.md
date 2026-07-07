# Admin panel design

**Date:** 2026-07-07
**Status:** Approved, not yet implemented

## Problem

There's currently no way to see, at a glance, when players are syncing (first
sync, most recent sync) or spot accounts that have gone quiet. Answering a
question like "why didn't Cham's new PB show up?" required manually querying
the production database by hand. This spec adds an internal admin panel to
make that self-serve.

It also surfaces a real gap in the current schema: `players.updatedAt` is
only rewritten when a player's display name changes, so a routine sync that
changes nothing (same name, no PB improvements) touches no timestamp at all
today. "First sync" and "last sync" are not reliably derivable from the
current data.

## Data model changes

Add two columns to `players` (`backend-hono/src/db/schema.ts`):

- `createdAt` (timestamp, not null) — set once at insert time, never
  rewritten again. This becomes the true "first sync" value going forward.
- `lastSyncedAt` (timestamp, not null) — rewritten on every successful sync
  call in `sync.ts`, regardless of whether the display name or any PB
  actually changed. This is the missing signal needed for "last sync."

For the ~24 players already in the table, there's no way to know their true
first-sync date retroactively — nothing recorded it. The migration backfills
both new columns from the existing `updatedAt` value as the best available
approximation. This will be slightly wrong for anyone who changed their
display name since their actual first sync (since `updatedAt` gets
overwritten by that), but it's the closest available proxy, and every player
going forward gets it exactly right.

Schema changes are applied with `drizzle-kit push` (`npm run db:push`),
matching how this project already manages schema — no migration-file system
is in place, and this doesn't introduce one.

New `admins` table:

- `id`
- `username` (unique)
- `passwordHash`
- `passwordSalt`
- `createdAt`

One row per person (Steph, George, anyone added later) rather than a single
shared credential — access can be added/revoked per person without changing
a secret everyone else also knows.

## Backend API

New routes mounted at `/api/admin/*`, protected by an HTTP Basic Auth
middleware:

- **`GET /api/admin/players`** — one row per player: `id`, `displayName`,
  `createdAt`, `lastSyncedAt`, `pbCount` (count of their `personal_bests`
  rows). Sorting happens client-side — the dataset is ~24 rows today, nowhere
  near needing server-side pagination/sorting.
- **`GET /api/admin/players/:id`** — the player summary plus their full
  `personal_bests` list (`boss`, `timeSeconds`, `updatedAt`), for the
  drill-down view. 404s if the id doesn't exist.
- **`GET /api/admin/stats`** — aggregate counters via simple SQL aggregates:
  `totalPlayers`, `totalPbs`, `playersSyncedLast24h` (`lastSyncedAt >= now()
  - interval '24 hours'`), `playersInactive7d` (`lastSyncedAt < now() -
  interval '7 days'`). The 24h/7d thresholds are hardcoded constants for v1,
  not configurable.

`sync.ts`'s `upsertPlayer` changes: it currently only writes `updatedAt` when
the display name changes. It now also always sets `lastSyncedAt = new
Date()` at the top of every successful sync call (auth passes, body is
valid), whether or not anything else in that sync changed.

## Auth

- HTTP Basic Auth on `/api/admin/*`. No custom login page, no
  sessions/tokens — the browser's native prompt handles credential entry and
  the browser resends the credential on every request per normal Basic Auth
  behavior.
- Credentials are **not** stored in env vars. They live in the new `admins`
  table: `username` + salted hash, checked at request time. Rotating a
  credential is a DB update, not an env var change + redeploy.
- Hashing: the existing `hashSecret()` in `lib/secret.ts` is plain unsalted
  SHA-256 — correct for the plugin's high-entropy install secret, but wrong
  for a human-chosen password (no salt, no deliberate slowness, brute-force
  friendly). Admin passwords use Node's built-in `crypto.scrypt` instead — a
  random salt per admin plus a computationally expensive hash. No new
  dependency.
- Password comparison uses `crypto.timingSafeEqual` on the hash bytes, not
  `===`, to avoid timing-attack leakage.
- Creating an admin: no signup UI (this panel is not user-facing) — a
  one-off script, `scripts/create-admin.ts <username> <password>`, run
  manually against `DATABASE_URL`, the same pattern
  `cleanup-untracked-bosses.ts` already uses.
- Failed-login throttling reuses the existing `isRateLimited()` helper from
  `lib/secret.ts` (already used for sync abuse), keyed by username.
- If the `admins` table is empty (e.g. before the seed script has been run),
  the middleware fails **closed** — denies all access rather than treating
  "no rows" as "no auth required."

## Frontend

- New client-side route `/admin` in the existing React app. The existing
  Vercel SPA-fallback rewrite already covers arbitrary paths, so no routing
  changes are needed there.
- Not linked from any nav/menu — reachable only by typing the URL.
- Auth flow: the page's data fetches (`/api/admin/stats`,
  `/api/admin/players`) hit a different origin (the backend). The browser
  intercepts the first `401` (which carries `WWW-Authenticate: Basic`) and
  shows its own native login prompt — no custom login form needed. Once
  entered, the browser caches the credential for that API origin for the
  session and auto-attaches it to subsequent requests. The page renders
  blank for a moment before the prompt appears, which is acceptable for an
  internal tool used by two people.
- Layout: a small stat row at the top (`totalPlayers`, `totalPbs`,
  `playersSyncedLast24h`, `playersInactive7d`) above a sortable table
  (`displayName` / `createdAt` / `lastSyncedAt` / `pbCount` columns,
  click-to-sort, ascending/descending toggle on repeat click). Sorting is
  client-side.
- Clicking a player row navigates to `/admin/players/:id`, showing their
  full `personal_bests` list (boss, time, last-updated) — the manual SQL
  query used to debug the Cham/Maggot King question, now a page.
- Styling reuses the existing dark theme / table styles from
  `Leaderboard.tsx` rather than introducing new CSS.

## Error handling & edge cases

- Missing/wrong credentials → `401`, browser re-prompts.
- Empty `admins` table → deny all (fail closed), not allow all.
- Repeated failed logins → throttled via the existing rate limiter, keyed by
  username.
- Drill-down for a nonexistent player id → `404`, frontend shows "player not
  found" instead of crashing.
- API/DB failure on the admin page → frontend shows "failed to load admin
  data, try refreshing" instead of a blank page or uncaught error.

## Testing

- Backend (`vitest`, matching existing `test/sync.test.ts` / `test/api.test.ts`
  conventions):
  - Auth middleware rejects missing/wrong/malformed credentials, accepts
    correct ones.
  - `/admin/players` and `/admin/players/:id` return correct shapes;
    `:id` 404s on an unknown player.
  - `/admin/stats` counts are correct against seeded fixture data.
  - scrypt hash/verify round-trips correctly.
  - Extend `sync.test.ts` to assert `lastSyncedAt` is bumped on every sync
    call, including a no-op resync where nothing else changes — this is the
    exact gap being fixed.
- Frontend: match whatever the existing test suite's actual coverage style
  is (component tests vs none) when writing the implementation plan, rather
  than inventing a new testing pattern in this spec.

## Out of scope for v1

- Configurable inactivity thresholds (hardcoded 24h/7d for now).
- Server-side pagination/sorting (dataset is tiny).
- A custom-styled login page or session/logout flow (Basic Auth's native
  prompt is sufficient for two internal users).
- A full sync-event log (this spec is per-player summary only, not a
  chronological activity feed).
