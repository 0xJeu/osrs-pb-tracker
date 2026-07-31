# Neon Compute-Wake and Redundant Lookup Reduction

**Status:** Approved direction; ready for implementation planning

**Date:** 2026-07-24

**Primary app repository:** `0xJeu/osrs-pb-tracker`

**Plugin repository:** `0xJeu/pb-tracker-sync`

**Plugin distribution repository:** `runelite/plugin-hub`

**Production database:** Neon project `snowy-fire-96856162`

## Summary

The PB Tracker must reduce the number of requests that reach Neon, especially
requests that repeat data already loaded or invalidate cached data that did not
change. Neon Free currently allows 100 CU-hours per month and suspends idle
compute after five minutes. A low but continuous stream of database-backed
requests can therefore consume the allowance even when each query is small.

The design has four immediate parts:

1. Prevent the RuneLite plugin from repeatedly loading the same local profile
   during one account session.
2. Prevent the website from fetching homepage and leaderboard data for views
   that do not render it.
3. Invalidate only cache entries whose response can actually change after a
   sync.
4. Replace broad profile dependency buckets with exact boss dependency tags
   while the current response cardinality safely fits Vercel's tag limit.

Secondary protections add a persistent successful-payload fingerprint to the
plugin, short browser caching, canonical request keys, universal-search request
controls, and measurement that distinguishes CDN hits from origin/database
work.

The intended result is not merely faster queries. It is longer periods with no
database queries at all, allowing Neon to reach its five-minute idle threshold
and scale to zero.

## Background and Current Evidence

The earlier egress work successfully:

- replaced repeated per-PB reads with a batched conditional upsert;
- added shared CDN caching to public read endpoints;
- added replay protection for identical sync payloads;
- stopped repeated automatic login sync scheduling for the same account
  session.

Those changes reduced transfer and write amplification, but the July 2026
compute allowance was still exhausted. The compute problem is distinct from
network transfer: cached responses can control egress while a trickle of cache
misses or writes still prevents the database from becoming idle.

Production and source inspection on 2026-07-24 found:

- The project had consumed approximately 101 CU-hours for the current billing
  cycle.
- The observed pace from July 22 to July 24 was approximately 3.5 CU-hours per
  day, which is too close to or above a 100 CU-hour monthly allowance.
- Vercel origin logs showed roughly one serverless invocation per minute in the
  sampled hour. That frequency makes a five-minute database-idle interval
  unlikely.
- Repeated player paths included the same names 6-11 times in an hour.
- The plugin's automatic sync is session-deduplicated, but the local "My PBs"
  sidebar load is not.
- A direct website load currently requests bosses, stats, recent syncs, five
  top-boss leaderboards, and a selected leaderboard regardless of whether the
  current route displays all of them.
- A changed PB currently invalidates boss list, universal search, stats, the
  changed player profile, the changed boss leaderboard, and a bucket of other
  profiles.
- Production currently has 90 players with PBs, an average of 46.1 PBs per
  player, and a maximum of 125 PBs on one profile.
- The 32 profile-bucket scheme touches an average of 52.5 profiles for a boss
  change, compared with 25.3 profiles using the exact boss dependency. The
  average invalidation multiplier is 5.5x, the worst bucket contains 78
  profiles, and eight profiles currently depend on all 32 buckets.

The backend uses Neon's HTTP driver rather than a long-lived connection pool.
There is no intentional database keepalive or scheduled health query in the
current app. The database remains active because application requests continue
to reach it.

## Goals

- Eliminate repeated same-player plugin lookups caused by repeated RuneLite
  login-state events, world hops, reconnects, or panel activation.
- Make each website view request only data that it renders.
- Reduce the homepage leaderboard fan-out from five requests to one.
- Keep public API responses shared-cacheable and reduce browser revalidation.
- Preserve cache correctness while making invalidation substantially narrower.
- Avoid invalidating stats, boss list, or search results for ordinary faster-PB
  updates.
- Ensure the universal search endpoint follows the same request and invalidation
  discipline.
- Skip unchanged automatic sync payloads across RuneLite restarts after a
  previously successful backend response.
- Preserve manual recovery paths and current public API behavior.
- Create measurable five-minute idle windows under low legitimate traffic.
- Keep the design safe as the number of players and PB records grows.

## Non-Goals

- Upgrading Neon or adding a paid infrastructure dependency.
- Suppressing legitimate first-time player lookups or meaningful PB updates.
- Weakening install-secret verification, rate limiting, or sync ownership
  checks.
- Making public data permanently stale.
- Removing ranks from the product without a separately reviewed product change.
- Treating CDN caching as a guarantee that the free tier can support unlimited
  unique traffic. Truly large unique traffic will require a database-independent
  public read model or a higher infrastructure allowance.
- Changing the existing five-minute Neon Free scale-to-zero setting, which is
  fixed by the provider.

## Design Principles

### Do not issue the request

Client-side session and in-flight deduplication are stronger than server-side
caching. A request that is never sent cannot invoke a function, miss a regional
CDN cache, or wake Neon.

### Invalidate by changed result, not by changed row

A PB time changing does not mean every public dataset changed. Cache
invalidation must follow response dependencies:

- player name changes affect search and name lookups;
- PB insertion affects record counts;
- a first-ever boss key affects boss discovery;
- a PB insertion or improvement affects that player and that boss's ranks;
- an unchanged sync affects nothing.

### Preserve a recovery path

Every automatic deduplication mechanism must have a deliberate bypass. Manual
sync and explicit refresh remain available if local state is wrong, the backend
was restored, or a prior response was lost.

### Optimize for idle windows

Success is measured by origin/database request gaps, not only by average query
latency or response size. Ten faster requests spread across ten minutes are
worse for scale-to-zero than a short burst followed by silence.

## Workstream A: RuneLite Local-Profile Lookup Deduplication

### Current behavior

`PbTrackerPlugin.onLoggedIn()` calls both the automatic sync scheduler and
`loadLocalPlayerPanelWhenReady(0)`. The automatic sync scheduler has an
account-session gate. The sidebar load does not.

Every successful sidebar readiness attempt calls
`PbTrackerSidePanel.onLocalPlayerChanged(displayName)`, which calls
`MyPbsTab.load(displayName)`. `MyPbsTab.load` always starts a new thread and
calls `SyncClient.lookupPlayer(displayName)`. Its request generation counter
only prevents an old response from replacing a newer response; it does not
prevent duplicate requests.

### Required behavior

Introduce a local-profile load coordinator independent of the `syncOnLogin`
setting.

The coordinator tracks:

- current account hash;
- normalized current display name;
- whether a lookup is in flight;
- whether a usable result has already loaded for the current session;
- the time of the last failed attempt.

Rules:

1. The first `LOGGED_IN` state for an account schedules one local-profile load.
2. Repeated `LOGGED_IN` events for the same account and display name do not
   schedule another lookup.
3. A world hop or reconnect does not reload an already-loaded profile.
4. A different account hash starts a new session and permits one lookup.
5. A display-name change within the same account permits one lookup for the new
   normalized name.
6. Logout/login-screen states cancel pending retries and clear the session.
7. If the same name is already in flight, `MyPbsTab.load` returns without
   creating another thread.
8. A successful `FOUND`, `NOT_FOUND`, or `AMBIGUOUS` response is retained for
   the session. A successful sync with changed data can explicitly refresh it.
9. An `ERROR` response clears the in-flight state but applies a short retry
   backoff, recommended at 30 seconds, so repeated UI events cannot create an
   error storm.
10. Add an explicit "Refresh My PBs" action that bypasses the session result
    cache but still coalesces concurrent refresh attempts.

The coordination logic should be extracted from Swing rendering so it can be
unit-tested without timing real UI threads.

### Refresh after sync

After a successful sync:

- `updated > 0`: refresh the local profile once after cache invalidation has
  completed;
- `updated == 0` or `deduplicated == true`: retain the current loaded profile;
- manual user refresh: always permit one request;
- sync error: do not discard a valid loaded profile.

If the backend response does not currently expose enough information to make
this decision, extend only the plugin's internal response model; preserve the
public response fields already used by released clients.

## Workstream B: Persistent Successful-Sync Fingerprints

The backend replay cache reduces duplicate work only while its process-local
entry remains available. The plugin should also avoid sending an unchanged
automatic payload after RuneLite restarts.

### Fingerprint

Build a deterministic SHA-256 fingerprint from:

- normalized account identity key;
- normalized display name;
- canonical boss keys sorted lexicographically;
- normalized numeric PB values.

Persist the fingerprint only after a successful accepted backend response.
Store it in RuneLite configuration under an opaque per-account key. Do not log
the raw account hash, install secret, full payload, or fingerprint.

### Rules

- Automatic login sync with the same fingerprint: skip the POST and report a
  concise "No PB changes since last successful sync" status.
- A live PB change produces a new fingerprint and syncs normally.
- A display-name change produces a new fingerprint and syncs normally.
- Manual "Sync all PBs now" bypasses the fingerprint check.
- A failed or rejected request never updates the stored fingerprint.
- Install-recovery flows bypass or clear the fingerprint when required.
- A future data-format version change must include a fingerprint schema version
  so old values fail open and perform one new sync.

This mechanism complements, rather than replaces, backend replay protection and
conditional upserts.

## Workstream C: Website View-Scoped Fetching

Split the current mount-wide effects into view-specific effects.

### Request budget by view

After implementation, initial requests should be bounded as follows:

| View | Required initial API requests |
| --- | --- |
| Home | bosses, stats, recent syncs, leaderboard overview |
| Player | one player profile |
| Boss | bosses and the selected leaderboard |
| FAQ | zero |
| Setup | zero |

Universal search requests occur only after user input and are not part of the
initial view budget.

### Required changes

- Fetch stats only when `view.name === 'home'`.
- Fetch recent syncs only when `view.name === 'home'`.
- Fetch top-boss data only when `view.name === 'home'`.
- Fetch a selected leaderboard only when `view.name === 'boss'`.
- Do not let the default `selectedBoss` trigger a hidden leaderboard request.
- Load the boss list on home and boss views. On other views, universal search
  may supply boss suggestions without preloading the complete list.
- Preserve already-loaded state during client-side navigation so returning to
  the home view does not immediately refetch the same data.
- Abort or ignore requests whose view is no longer active.

Frontend tests must assert request counts and paths for every route. A visual
test alone is insufficient because hidden effects can regress without changing
the rendered page.

## Workstream D: One-Request Homepage Leaderboard Overview

Replace the five `limit=1` leaderboard requests with one public endpoint:

```text
GET /api/leaderboard-overview
```

The endpoint uses a server-owned curated boss list so there is one stable cache
key. Its response contains only the fields rendered by the homepage cards:

```json
[
  {
    "boss": "zulrah",
    "leader": {
      "displayName": "Example",
      "timeSeconds": 42.6,
      "updatedAt": "2026-07-24T12:00:00.000Z"
    }
  },
  {
    "boss": "vorkath",
    "leader": null
  }
]
```

Implementation requirements:

- Use one SQL statement for every configured boss, preferably a window function
  or `DISTINCT ON` query with deterministic tie ordering.
- Return at most one row per configured boss.
- Attach the normal exact boss cache tags for every included boss.
- Apply the public shared-cache policy.
- A PB change for one configured boss invalidates the overview through that
  boss tag.
- Do not accept arbitrary unbounded boss lists from the caller.

## Workstream E: Canonical Client Request Keys and Short Client Caching

### Canonical URLs

Before constructing a URL:

- trim and lowercase player names, boss keys, search queries, and highlight
  names;
- clamp and integer-normalize limit and offset;
- omit empty optional parameters;
- emit query parameters in a consistent order.

`getLeaderboardPage` must follow the same normalization already used by the
smaller leaderboard helper. This prevents semantically identical requests from
creating separate CDN keys.

### In-flight and session caches

The website API client should coalesce identical in-flight GETs. It may retain
successful immutable response promises or parsed values for the browser session
with endpoint-specific limits:

- player profile: five minutes;
- boss list: session lifetime;
- stats/recent/overview: two minutes;
- universal search: five minutes with a bounded least-recently-used entry count.

Do not permanently cache rejected promises. A failed request must be retryable.
Expose a targeted invalidation helper for future flows that know data changed.

### Browser cache header

Keep the one-day shared CDN policy, but change public browser behavior from
mandatory immediate revalidation to a short freshness window:

```text
Cache-Control: public, max-age=120
CDN-Cache-Control: public, max-age=86400, stale-while-revalidate=604800
```

The accepted tradeoff is that a browser may display public data up to two
minutes after a backend cache-tag invalidation. This is preferable to every
navigation contacting the edge, and it does not expose private data because the
responses are already public.

## Workstream F: Selective Sync Invalidation

Change `upsertPbs` from returning one undifferentiated `changedBosses` array to
returning enough information to distinguish:

- newly inserted PB rows;
- existing PB rows improved by a faster time;
- unchanged rows.

Avoid a per-PB pre-read. Use a bounded set-based SQL design, such as an insert
phase and conditional update phase within one transaction, or an equivalent
single-statement design whose insert/update classification is tested against
the production PostgreSQL version.

### Invalidation truth table

| Event | Required invalidations |
| --- | --- |
| Fully unchanged sync | none |
| New player | stats, search, recent syncs, player ID/name |
| Display-name change | search, recent syncs, player ID, old name, new name |
| New PB for an existing boss | stats, player ID, exact boss/profile dependencies |
| Faster time for existing PB | player ID, exact boss/profile dependencies |
| First-ever database boss key | boss list and universal search, in addition to new-PB invalidations |
| Install-secret claim only | none of the public data caches |

Details:

- `stats` counts players and PB rows. It changes for a new player or PB
  insertion, not for a faster-time update.
- `bossList` changes only when the first PB for a previously absent boss key is
  inserted.
- Universal search changes for a new player, rename/history change, or
  first-ever boss key. It does not change when a known player's PB gets faster.
- Boss leaderboards and rank-bearing player profiles change for both PB
  insertion and improvement.
- An unchanged sync must not call cache invalidation.

For newly inserted PBs, determine whether a boss key is globally new with one
bounded query over only the inserted keys. Do not query the complete boss table
once per PB.

## Workstream G: Exact Profile Dependency Tags

### Current problem

A cached player profile includes ranks. When one boss time changes, ranks for
other players with that boss may change. The current implementation preserves
correctness by tagging profiles with one of 32 hashed boss buckets. Each bucket
contains unrelated bosses, producing broad invalidation.

### Exact-tag design

Add an exact profile dependency tag:

```text
profile-boss:<normalized-or-hashed-boss-key>
```

For a normal profile response, attach:

- player ID tag;
- player-name tag on the name route;
- one exact profile-boss tag per PB.

The name route must reserve two tag slots, so exact tags are used only when the
profile has at most 126 PBs. Production's current maximum is 125, so every
current profile fits.

For a future profile above the threshold:

- fall back to the existing 32 bucket tags for that profile response;
- never silently truncate dependency tags;
- log only a sampled, credential-free fallback counter.

When a boss changes, invalidate both:

- its exact `profile-boss` tag;
- its legacy/fallback bucket tag.

Invalidating both keeps exact-tag and fallback responses correct during rolling
deployments and for oversized future profiles.

Tests must prove:

- a 125-PB name response stays below 128 unique tags;
- a 126-PB name response reaches but does not exceed the limit;
- a 127-PB response uses the fallback rather than slicing tags;
- changing one boss invalidates exact and fallback dependencies;
- no player-name or player-ID invalidation is lost.

## Workstream H: Universal Search Controls

`GET /api/search/all` currently performs current-name, historic-name, and boss
queries. It is covered by shared caching, but unique queries can still reach
Neon.

Required changes:

- Require at least two trimmed characters in the frontend and backend.
- Canonicalize the query before building the URL.
- Debounce at 250-300 milliseconds.
- Cancel superseded browser requests with `AbortController`.
- Coalesce identical in-flight searches.
- Keep a bounded five-minute session cache of successful results.
- Ensure a late response cannot replace results for newer input.
- Preserve the existing maximum response size.
- Apply the selective invalidation rules from Workstream F.

As a secondary query-shape improvement, evaluate combining the three search
queries into one bounded SQL statement. This is worthwhile only if it reduces
round trips without making the query harder to index or maintain. It must not
delay the client-side request controls, which prevent requests entirely.

## Workstream I: Player Rank Query Follow-Up

On an uncached profile request, the backend:

1. queries current and historic player names;
2. loads the player's PB rows;
3. calculates a correlated rank count for every PB.

This route is more expensive than a simple player lookup. Exact dependency tags
and request deduplication should first reduce how often it runs.

After those changes deploy, capture a production-representative `EXPLAIN
(ANALYZE, BUFFERS)` on a disposable Neon branch for:

- a small profile;
- an average profile;
- a profile near the current 125-PB maximum.

Only if the rank work remains material should a follow-up choose among:

- a set-based rank/window query;
- a separately cached rank overlay keyed by exact bosses;
- rank calculation only when the requesting surface renders ranks.

Do not split ranks into many per-boss HTTP requests. That would trade one
database-backed profile request for dozens of smaller requests and work against
the scale-to-zero goal.

## Workstream J: No Hidden Keepalive Behavior

Maintain these invariants:

- no cron job solely to warm the database;
- no health/readiness endpoint that queries Neon during routine monitoring;
- no client polling for stats, recent syncs, player profiles, or leaderboards;
- no database connection pool configured with application-level keepalive;
- no automatic cache warmer that touches every player or boss;
- no observability query on every public cache hit.

Health endpoints should report process availability without querying Neon.
Database reachability checks should be explicit diagnostics, not continuous
production traffic.

## API Compatibility

Existing released plugin and website contracts remain valid:

```text
POST /api/sync
GET  /api/players/:name
GET  /api/players/by-id/:id
GET  /api/search?q=<query>
GET  /api/search/all?q=<query>
GET  /api/leaderboard/:boss
GET  /api/bosses
GET  /api/recent-syncs
GET  /api/stats
```

One additive endpoint is introduced:

```text
GET /api/leaderboard-overview
```

The sync response may retain or add optional diagnostic fields, but released
clients must continue to work if they ignore them.

## Observability

Do not log display names as a new structured metric dimension. Vercel request
paths already contain player names; new application metrics should use route
templates and aggregate counts.

Track:

- serverless origin invocations by route template;
- `/api/players/*` requests and approximate unique-path ratio;
- plugin automatic sync attempts, skips by session gate, skips by fingerprint,
  and manual bypasses;
- profile lookup skips by loaded/in-flight/backoff reason;
- cache invalidations by logical dataset, not raw tag value;
- exact-tag versus bucket-fallback profile responses;
- Neon project and branch compute consumption;
- longest and median database-idle gaps;
- CDN `HIT`, `MISS`, and `STALE` observations from controlled checks.

Metrics and logs must never include:

- install secrets or hashes;
- database URLs;
- account hashes;
- full sync payloads;
- full fingerprint values.

## Rollout Plan

### Phase 1: Stop avoidable client requests

Repositories:

- `0xJeu/pb-tracker-sync`
- `0xJeu/osrs-pb-tracker` frontend

Changes:

- plugin sidebar session and in-flight dedupe;
- explicit sidebar refresh;
- website view-scoped effects;
- canonical frontend request keys;
- universal-search request controls.

Deploy the website normally. Publish the plugin through:

1. plugin repository PR and merge;
2. exact commit pin update in Steph's plugin-hub fork;
3. PR to `runelite/plugin-hub`;
4. post-merge verification that the upstream manifest pins the intended
   commit.

### Phase 2: Narrow backend invalidation

Repository: `0xJeu/osrs-pb-tracker`

Changes:

- classify PB insertions and improvements;
- selective invalidation truth table;
- exact profile dependency tags plus fallback;
- short browser cache lifetime;
- homepage overview endpoint.

Deploy backend before the frontend switches to the new overview endpoint, or
retain a temporary frontend fallback during the rolling deploy.

### Phase 3: Persistent plugin payload fingerprints

Repository: `0xJeu/pb-tracker-sync`

Ship separately from sidebar dedupe if that keeps Plugin Hub review smaller.
Verify manual sync and install-recovery bypasses before publishing.

### Phase 4: Measure and tune

Observe at least 48 hours and preferably seven days after the released plugin
has propagated.

If daily compute remains above the safety target, profile the rank query and
identify any remaining route preventing five-minute idle windows.

## Validation

### Plugin

Use JDK 17:

```bash
JAVA_HOME=$(/usr/libexec/java_home -v 17) gradle test
JAVA_HOME=$(/usr/libexec/java_home -v 17) gradle build
```

Required automated cases:

- repeated same-account `LOGGED_IN` events schedule one profile lookup;
- world hop schedules no additional profile lookup;
- account switch schedules one lookup for the new account;
- normalized same name coalesces in-flight requests;
- name change permits one new lookup;
- error backoff prevents rapid retries;
- manual refresh bypasses loaded state but coalesces concurrently;
- changed successful sync refreshes once;
- unchanged or replayed sync does not refresh;
- unchanged fingerprint skips automatic POST across restart;
- failed POST does not persist the fingerprint;
- manual sync bypasses fingerprint state.

### Backend

```bash
cd backend-hono
npm run typecheck
npm test
```

Required automated cases:

- invalidation truth table for every event type;
- exact-tag limit and fallback boundary;
- rolling-deploy invalidation of exact and bucket tags;
- overview query response, empty boss, tie ordering, and cache headers;
- browser and CDN cache headers;
- universal search minimum length and canonical response;
- unchanged sync performs no invalidation;
- no per-PB query loop is reintroduced.

### Frontend

```bash
cd frontend
npm test
npm run build
```

Required request-budget tests:

- home: four initial API paths and no hidden full leaderboard;
- player: one profile path;
- boss: boss list plus one canonical leaderboard path;
- FAQ/setup: zero initial API paths;
- navigation back to already-loaded home state does not refetch immediately;
- repeated same-player navigation uses the session cache;
- superseded search is aborted and cannot overwrite newer results.

### Production

- Confirm the backend and frontend deploys use the intended `fork/main` commit.
- Confirm the Plugin Hub manifest pins the intended plugin commit.
- Check repeated public GETs without cache-busting parameters and record
  `x-vercel-cache`.
- Review Vercel origin logs for one hour and 24 hours.
- Compare identical player-path counts with the pre-change sample.
- Verify a real changed PB invalidates its player and boss data.
- Verify an unrelated player's cached profile remains a CDN hit after that
  sync unless the shared boss rank actually affects it.
- Verify no 5xx increase.
- Record Neon compute at deploy, +24 hours, +48 hours, and +7 days.

## Success Criteria

The implementation is successful when:

- repeated same-account RuneLite login states produce one sidebar profile GET;
- unchanged automatic payloads produce no POST after a stored successful
  fingerprint;
- player, FAQ, and setup page loads make no homepage-data requests;
- non-boss pages make no hidden leaderboard request;
- homepage top cards use one overview request;
- faster-time PB updates do not invalidate stats, boss list, or universal
  search;
- current profiles use exact boss dependency tags;
- bucket fallback is tested and visible only as an aggregate metric;
- no-op syncs invalidate nothing;
- the seven-day rolling compute pace is below 2.5 CU-hours per day, providing a
  safety margin under 100 CU-hours per 30 days;
- low-traffic periods contain regular database-idle gaps longer than five
  minutes.

The 2.5 CU-hour daily target is an operating safety target, not a provider
guarantee. If legitimate unique traffic alone exceeds it, further caching of
the same architecture cannot guarantee the free tier.

## Future Scale Boundary

At larger scale, every truly unique uncached player or leaderboard request can
still wake Neon. If the work above eliminates redundant traffic but legitimate
traffic threatens the allowance, the next architecture should make public
reads database-independent:

- Neon remains the authoritative write store.
- A successful sync updates compact public player and leaderboard read models.
- Public GETs read those models from an object/edge store rather than querying
  Neon.
- Rebuild tooling can regenerate the read models from Neon on demand.

That is a separate design because it introduces another storage system,
consistency rules, rebuild procedures, and provider limits. It should be
triggered by measured legitimate traffic, not added prematurely.

## Definition of Done

- All three implementation repositories have clear, reviewable changes.
- Automated validation passes using the required runtimes.
- Website and backend are deployed from synchronized `dev` and `main`.
- Plugin repository changes are merged and the upstream Plugin Hub manifest is
  updated.
- Production cache correctness is manually verified after a real PB change.
- Neon and Vercel measurements are recorded for at least 48 hours.
- The older egress follow-up document points to this specification as the
  current compute-wake design.
