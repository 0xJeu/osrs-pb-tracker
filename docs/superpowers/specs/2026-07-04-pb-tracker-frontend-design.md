# PB Tracker Frontend Design

## Goal

Build a Vercel-deployable frontend for OSRS PB Tracker that can replace the
current static `website/` prototype without requiring Next.js or server-side
rendering. Phase 1 should preserve the current public lookup and leaderboard
flows, improve the UI structure, and leave a clear path toward richer public
leaderboard and profile features later.

## Current State

The repo currently has a working static site in `website/`:

- `website/index.html` provides one page with player search, boss selection,
  and a results area.
- `website/app.js` fetches directly from the backend API and renders player
  results, ambiguous-name selection, boss leaderboards, search suggestions,
  and URL states for `?player=` and `?boss=`.
- `website/style.css` provides a compact dark OSRS-themed interface.

The Hono backend rebuild deliberately keeps this site unchanged during backend
work. Its docs identify the frontend rebuild as a separate future sub-project:
the static site is served during local Hono dev only until a Vite frontend
replaces it.

## Product Direction

The selected Phase 1 direction is **Search-First Static App**.

This keeps the first deployable frontend focused:

- Player lookup is the primary action.
- Boss leaderboard browsing remains visible and useful, but secondary.
- Player and leaderboard result views should feel cleaner, more reliable, and
  more OSRS-native than the prototype.
- The app should be easy to deploy as static assets on Vercel.

Two richer directions are intentionally deferred to the roadmap:

- **Public Leaderboard Hub:** a more complete homepage with boss directory,
  recent syncs, popular bosses, and global activity.
- **Profile Product:** richer player profile pages with rank context,
  comparison, install calls-to-action, and eventual account claim/hide/manage
  flows.

## Phase 1 Scope

Phase 1 replaces the static prototype with a small Vite + React + TypeScript
frontend app in `frontend/`. React is the chosen UI framework: it has the
largest ecosystem, pairs naturally with the project's Vercel tooling, and the
app is small enough that framework overhead is not a concern. The important
requirement is a static build output that Vercel can host without SSR.

Required user-facing flows:

1. Search for a player by display name.
2. Show a single player's synced PB list.
3. Show an ambiguous-name picker when the API reports multiple matching player
   rows.
4. Browse the available boss list.
5. Show a top-times leaderboard for a selected boss.
6. Show a compact recent-sync surface so the project owner and visitors can
   tell whether players have been syncing recently.
7. Support URL-driven states for shared links, equivalent to today's
   `?player=` and `?boss=` behavior.
8. Show useful loading, empty, not-found, and backend-unreachable states.

The app should preserve the existing public nature of the project: no login is
required to view synced PBs.

## Non-Goals

Phase 1 does not include:

- Next.js or server-side rendering.
- User accounts or authentication.
- Claiming, hiding, deleting, or managing profiles.
- Player comparison.
- Global rank calculation beyond data already returned by the current API.
- Recent activity, popular bosses, or homepage stats unless the current API can
  support them without expansion.
- Backend API changes unless they are strictly necessary to configure the
  frontend for deployment.
- SEO / crawlable per-player and per-boss pages. This is the known tradeoff of
  choosing a client-rendered Vite SPA over Next.js SSR/SSG, accepted
  deliberately when the stack was selected. If search-engine discoverability
  of player or boss pages becomes a priority later, that is a framework-level
  revisit, not a Phase 1 patch.

## API Contract

The frontend must treat the current backend API contract as stable:

```text
GET /api/players/:name
GET /api/players/by-id/:id
GET /api/search?q=<query>
GET /api/leaderboard/:boss?limit=<n>
GET /api/bosses
GET /api/recent-syncs?limit=<n>
```

`POST /api/sync` is used by the RuneLite plugin and should not be called by the
public frontend in Phase 1.

The frontend should centralize API access behind a small client module rather
than scattering `fetch()` calls across view code. The API base URL must be
configurable:

- Local dev should be able to call `http://localhost:3000`.
- Production should be able to call the deployed Hono API URL.
- When `VITE_API_BASE_URL` is unset, the client must fall back to same-origin
  relative paths (`/api/...`). This is the defined default, not an undefined
  state — it keeps a combined frontend+API deployment working with zero
  configuration if the two are ever hosted together.

The frontend should handle these response shapes:

- `GET /api/players/:name` returns `404` for unknown players.
- `GET /api/players/:name` returns a full player payload for one match.
- `GET /api/players/:name` returns an ambiguous response for multiple
  display-name matches:

```json
{
  "ambiguous": true,
  "matches": [
    {
      "id": 1,
      "displayName": "Blitzen",
      "updatedAt": "2026-07-04T18:00:00.000Z"
    }
  ]
}
```
- `GET /api/leaderboard/:boss` returns an array sorted fastest first.
- `GET /api/bosses` returns an array of boss names.
- `GET /api/search` returns an array of matching display names.
- `GET /api/recent-syncs` returns recent player sync summaries ordered newest
  first. Each row should include `id`, `displayName`, `updatedAt`, and `pbCount`.
  The endpoint should clamp `limit` to a small public maximum such as `25`.

```json
[
  {
    "id": 5,
    "displayName": "ChampSide",
    "updatedAt": "2026-07-05T19:35:04.453Z",
    "pbCount": 24
  }
]
```

## Information Architecture

The Phase 1 app can remain a single-page app. It should have three conceptual
view states:

1. **Home/Search:** primary search input, boss browse control, and a concise
   explanation that data appears after a player syncs with the RuneLite plugin.
2. **Player Result:** player display name, last synced timestamp, number of
   visible PBs, and a PB table/list.
3. **Boss Leaderboard:** boss title, top times table/list, and a clear path back
   to search.
4. **Recent Syncs:** a small home-page panel or section listing the newest
   synced players, their latest sync time, and how many PBs they have synced.

The ambiguous-name picker is a sub-state of player lookup. It should explain
that display names are not unique due to renames/reused names, then let the user
select a specific matching row.

## UI Requirements

The interface should stay dark, practical, and data-forward. It should borrow
the sharper OSRS Tool Suite direction rather than looking like a generic brown
prototype.

Visual requirements:

- Dark background with restrained OSRS gold accents.
- Dense but readable layout for repeated lookup use.
- No marketing landing page. The first screen must be the working search and
  leaderboard experience.
- Player and leaderboard tables must work on mobile; if tables become cramped,
  switch to stacked rows/cards at narrow widths.
- Time values should be visually prominent and consistently formatted.
- Empty and error states should be clear without feeling alarming.

Interaction requirements:

- Search suggestions should remain debounced.
- Boss selection should be searchable.
- Recent-sync rows should link into the same player result state as search.
- Shared URLs should restore the selected player or boss. When both `?player=`
  and `?boss=` are present, `?player=` takes precedence, matching today's
  behavior.
- Browser history should update when selecting a player or boss.
- The app should escape or safely render all user-provided/display-name values.
- The boss combobox and the ambiguous-name picker must be keyboard-navigable
  (arrow keys, Enter to select, Escape to close) with visible focus states.
  The current prototype's combobox is mouse-only; the rewrite is the moment
  to fix this cheaply rather than retrofit it later.
- Error-state copy must be written for end users, not developers. The
  prototype's "Could not reach the server. Is the backend running?" assumes
  the reader operates the backend; production copy should read more like
  "Couldn't load data — try again shortly."

## Data Presentation Rules

The current prototype hides ambiguous bare raid entries when more specific raid
variants exist. Phase 1 should preserve that behavior unless the backend later
normalizes boss categories.

Time formatting should preserve today's behavior:

- Show `m:ss` for sub-hour times.
- Show `h:mm:ss` for hour-plus times.
- Preserve two decimals only when a synced time has fractional seconds.

Dates should be displayed in the user's locale, with graceful fallback if the
API returns an unexpected value.

## Deployment Requirements

The frontend should deploy independently to Vercel as a static site.

Expected shape:

- `frontend/package.json` includes scripts for `dev`, `build`, `preview`, and
  `test`.
- `frontend/vite.config.ts` produces static assets in `frontend/dist`.
- `frontend/.env.example` documents the API base URL variable.
- `frontend/vercel.json` should set `buildCommand` and `outputDirectory` if the
  Vercel project is rooted at `frontend/`; repo-root Vercel configuration can
  be used instead if the deployment is created from the monorepo root.
- Vercel should be able to build the app with the frontend package's build
  command and serve `dist`.

The frontend deployment must not require the old Express `backend/` to serve
static files. The Hono API deployment and frontend deployment may be separate
Vercel projects if that keeps the architecture simpler.

**CORS dependency:** with separate Vercel projects, every frontend request is
cross-origin, so this plan silently depends on the Hono API's CORS policy
staying permissive (it is wide-open `cors()` today). That is acceptable for a
public read-only API, but a backend code review has already flagged revisiting
CORS when auth or additional write routes are added. If the API ever narrows
its CORS policy, the frontend's deployed origin(s) must be added to the
allowlist as part of that change — this spec records the dependency so it is
not discovered as a production outage.

## Testing And Verification

Phase 1 should use Vitest for unit tests and Playwright for browser smoke tests.
Playwright tests must run against mocked API responses (Playwright route
interception), not a live seeded backend — otherwise CI acquires a Neon
dependency and the suite gets flaky for reasons unrelated to the frontend.
A live-backend pass belongs in the manual verification checklist below, not in
the automated suite. It should include enough automated coverage to protect the
core public flows:

- Unit tests for formatting helpers such as PB time formatting.
- Unit tests for API response handling, especially unknown player,
  ambiguous-name, leaderboard responses, and recent-sync responses.
- Browser or component-level smoke tests for:
  - initial load
  - player search success
  - unknown player state
  - ambiguous player picker
  - boss leaderboard load
  - recent-sync list load
  - URL restoration for `?player=` and `?boss=`

Manual verification before calling the frontend ready:

1. Run the Hono backend locally.
2. Sync or seed at least one player with PBs.
3. Run the frontend locally against that backend.
4. Search a known player.
5. Open a boss leaderboard.
6. Confirm the recent-sync panel shows the latest seeded or live player.
7. Open direct URLs for `?player=<name>` and `?boss=<boss>`.
8. Build the frontend and preview the production output.

## Roadmap

### Public Leaderboard Hub

After Phase 1 is deployed, the frontend can evolve into a more complete public
hub. Likely additions:

- Boss directory with categories for raids, bosses, and special variants.
- Popular bosses based on synced PB counts.
- Recent syncs or recent PB improvements.
- Homepage summary stats such as tracked bosses, synced PBs, and synced players.
- Dedicated boss pages with richer context.

This likely needs backend additions for aggregate counts and recent activity.

### Profile Product

The profile-product direction should wait until the public lookup foundation is
solid. Likely additions:

- Dedicated player profile routes.
- Player comparison.
- Rank context per boss.
- Install/setup call-to-action for players who want to sync their own PBs.
- Account claim, hide, or manage flows if privacy/product needs justify auth.

This requires backend work for auth, profile ownership, privacy states, and
possibly derived ranking data.

## Implementation Defaults

The implementation plan should use these defaults unless there is a concrete
repo constraint that makes one impractical:

- Use Vite + React + TypeScript in `frontend/`.
- Use Vitest for formatting and API-client unit tests.
- Use Playwright for browser smoke tests against mocked API responses (route
  interception); reserve live-backend runs for manual verification.
- Keep `website/` in place during migration. Replace or retire it only after
  the Vite app reaches parity and passes verification.
- Prefer a separate Vercel static frontend project pointing at `frontend/`,
  with `VITE_API_BASE_URL` set to the deployed Hono API URL.
