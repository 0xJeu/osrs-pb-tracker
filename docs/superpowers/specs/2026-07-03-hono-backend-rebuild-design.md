# Hono Backend Rebuild — Design

## Goal

Replace the current Express + local-SQLite backend (`backend/`) with a TypeScript
Hono backend on Neon Postgres, deployable to Vercel — while keeping the
existing static website and RuneLite plugin working against it unchanged.

## Scope

**In scope:** the backend only. New `backend-hono/` directory alongside the
existing `backend/`, which stays untouched and running until the new backend
is verified working end-to-end (including a real sync from the RuneLite
plugin), at which point `apiBaseUrl` gets pointed at the new backend and
`backend/` is retired.

**Out of scope (separate future sub-project):** rebuilding the website in
Vite. The static `website/` folder is served as-is by the new backend during
this phase, exactly like `express.static` does today.

**Explicitly not doing in this pass:**
- Migrating existing local SQLite data into Neon — start fresh; the plugin
  re-syncs everything on the next "Sync all PBs now."
- A durable/distributed rate limiter (Upstash Redis, Vercel KV) — see
  "Rate limiting" below.

## Architecture

**Structure:** `backend-hono/`, TypeScript throughout.

**Runtime split:** a single shared `src/app.ts` defines the Hono app (routes +
middleware). Two thin entrypoints reuse it:
- `src/index.node.ts` — local dev via `@hono/node-server`'s `serve()`
  (`npm run dev` behaves like today's `npm start`)
- `api/index.ts` — Vercel deployment via the `hono/vercel` adapter

Both entrypoints run identical route logic; only the hosting wrapper differs.

**Data layer:** Neon Postgres via `@neondatabase/serverless` (HTTP driver) +
Drizzle ORM (`drizzle-orm/neon-http`). Schema mirrors today's SQLite tables:

- `players` — id, account_hash (unique), display_name, display_name_lower,
  install_secret_hash (nullable), updated_at
- `personal_bests` — id, player_id (FK), boss, time_seconds, updated_at,
  unique(player_id, boss)

Postgres translation notes: `AUTOINCREMENT` → `SERIAL`/`IDENTITY`;
`COLLATE NOCASE` has no direct Postgres equivalent — comparisons use explicit
`LOWER()` on both sides instead (matching the app's existing convention of
storing `display_name_lower` for exactly this reason).

**Routes (exact 1:1 contract with today — same paths, request/response JSON
shapes, status codes):**

```
POST /api/sync
GET  /api/players/:name
GET  /api/players/by-id/:id
GET  /api/search
GET  /api/leaderboard/:boss
GET  /api/bosses
```

The website and plugin require zero changes to keep working against this
backend.

**Static site serving:** `@hono/node-server/serve-static` serves `../website`
during local dev, matching today's behavior. This requirement disappears once
the Vite frontend sub-project replaces the static site.

## Data flow

- **`POST /api/sync`** — validate `accountHash`/`displayName`/`installSecret`
  (≥16 chars)/`pbs` (same 400s as today) → rate-limit check (see below) →
  hash `installSecret` with Node's built-in `crypto` → TOFU claim via Drizzle:
  new account_hash inserts with the secret hash; an existing row with a null
  secret hash (legacy data) claims it; a hash mismatch returns 409; otherwise
  proceeds → upsert each boss's PB only if strictly better than the stored
  value, identical to today's `upsertPb`.
- **`GET /api/players/:name`** — query `WHERE LOWER(display_name) = LOWER($1)`
  ordered by `updated_at DESC`. 0 rows → 404. 1 row → full player + PBs
  payload. 2+ rows → `{ambiguous: true, matches: [...]}`, matching the
  disambiguation picker already built and tested on the website.
- **`GET /api/players/by-id/:id`**, **`/api/search`**, **`/api/leaderboard/:boss`**,
  **`/api/bosses`** — straight ports of today's query semantics.

## Rate limiting (explicit trade-off)

Today's limiter is an in-memory `Map`, viable because Express runs as one
long-lived process. On Vercel serverless, requests can land on different
container instances (cold starts, concurrent load), so in-memory state won't
reliably persist or share across invocations — the 30-requests/10-minutes
limit becomes best-effort-per-instance rather than a hard global guarantee.

**Decision: keep the same in-memory approach.** For a low-traffic hobby
project this still meaningfully deters casual spam. Adding a durable store
(Upstash Redis, Vercel KV) is real added scope and infrastructure we don't
need yet — revisit only if this sees real production traffic.

## Error handling

Same JSON error shape and status codes everywhere: `{error: "..."}` with
400/404/409/429/500. A single global `app.onError(...)` handler catches
anything unexpected and returns `{error: "Internal error"}` with 500 — one
place instead of a try/catch duplicated in every route (today's pattern).
Route logic still explicitly returns the specific 400/404/409/429 cases.

## Testing

**Automated:** Vitest, testing the Hono app directly via `app.request()` (no
real server needed). One test file per route:
- `sync.test.ts` — validation 400s, first-sync claim, same-secret resync,
  mismatched-secret 409, rate-limit 429
- `players.test.ts` — single match, 404, ambiguous multi-match shape
- `leaderboard.test.ts` — sort order, limit clamping
- `bosses.test.ts` / `search.test.ts` — list/filter checks

**Test database:** a dedicated Neon branch (cheap/fast to provision via the
already-available Neon MCP connector), tables truncated between test files —
real Postgres semantics instead of a mocked query builder. This is a net-new
improvement over today's project, which has zero automated backend tests.

**Manual end-to-end verification:** run the new backend locally, point the
existing website at it unchanged, point the RuneLite plugin at it, confirm a
real sync round-trip — same bar used to verify the current backend.

## Rollout

1. Build `backend-hono/` fully, with `backend/` left running untouched.
2. Verify locally: website + real plugin sync against the new backend.
3. Point the plugin's `apiBaseUrl` at the new backend (still localhost during
   dev), confirm parity.
4. Deploy `backend-hono/` to Vercel, wired to the Neon database.
5. Retire `backend/` once the cutover is confirmed stable.
