# Neon Egress Follow-ups

**Project:** `osrs-pb-tracker`
**Date:** 2026-07-14
**Purpose:** Issue-ready backlog for reducing Neon public network transfer after the critical login-sync fix deploys.

## Current status

The urgent fix is implemented on `fix-neon-egress-sync` in commit `76e211f`.
It replaces the sync route's repeated full-PB reads with one batched conditional
upsert. For an unchanged 60-PB login payload, the PB portion moves from roughly
60 queries returning about 3,600 rows to one statement returning zero changed
rows.

This document intentionally keeps the remaining runtime changes out of that
focused fix. The items below can be copied into GitHub issues after the first
fix is reviewed and deployed.

## Production observations

Repeated header checks against the production backend on 2026-07-14 showed:

| Endpoint | Production cache result |
| --- | --- |
| `/api/stats` | `x-vercel-cache: HIT` after the initial request |
| `/api/bosses` | Repeated `x-vercel-cache: MISS` |
| `/api/recent-syncs?limit=10` | Repeated `x-vercel-cache: MISS` |
| `/api/leaderboard/zulrah?limit=25` | Repeated `x-vercel-cache: MISS` |

Neon counts database result data sent through its proxy as network transfer.
Repeated uncached queries and unnecessarily large result sets therefore increase
the same allowance that the sync fix targets.

## Recommended order

1. Deploy the batched sync upsert and monitor Neon transfer.
2. Add explicit shared caching to safe public read endpoints.
3. Bound the highlighted-leaderboard query by changing its response contract.
4. Reduce the unreleased phase-two UI's initial leaderboard fan-out.
5. Apply smaller query-shape and search-request reductions.

---

## Issue 1: Add shared CDN caching to public read endpoints

**Priority:** High
**Expected impact:** Medium to high, depending on website traffic concentration.

### Problem

The boss list, recent syncs, normal leaderboards, and player profiles currently
reach the backend and Neon on every cache miss. Production checks confirmed
repeated Vercel cache misses for bosses, recent syncs, and leaderboards.

### Proposed scope

- Add explicit shared-cache headers to public GET responses.
- Suggested starting TTLs:
  - Boss list: 1 hour.
  - Stats and recent syncs: 30-60 seconds.
  - Normal leaderboards: 15-30 seconds.
  - Player profiles: 15-30 seconds.
- Prefer an explicit Vercel/shared-cache directive such as `s-maxage` or a
  targeted CDN cache-control header, optionally with `stale-while-revalidate`.
- Do not cache sync or feedback writes.
- Document the accepted short freshness delay after a successful sync.

### Acceptance criteria

- Route tests assert the intended cache headers.
- Repeated production requests show `x-vercel-cache: HIT` within the TTL.
- Cache keys keep distinct route parameters and query strings separate.
- No private or installation-secret data is present in a cached response.
- Player, leaderboard, and recent-sync data refresh within the documented TTL.

---

## Issue 2: Stop highlighted leaderboards from fetching up to 500 rows

**Priority:** Medium
**Expected impact:** High per affected request; workload-dependent overall.

### Problem

`backend-hono/src/routes/leaderboard.ts` fetches as many as 500 ordered rows when
a `highlight` name is supplied. The API often returns only the top 25 rows, so
most transferred rows can be discarded in application code.

### Proposed scope

- Calculate the highlighted player's rank in SQL.
- Return the top page plus a compact highlighted-player result, or a small
  window around the highlighted rank.
- Add an explicit rank field so the frontend does not infer rank solely from
  array position.
- Define stable tie behavior and a deterministic secondary ordering.

### Acceptance criteria

- A highlighted request transfers only the top page plus the required
  highlighted context, not every preceding row.
- Missing and case-insensitive highlights retain current user-visible behavior.
- Tied times display the agreed rank consistently.
- Tests cover top-25, deep-highlight, absent-highlight, and tied-time cases.

---

## Issue 3: Reduce phase-two UI leaderboard request fan-out

**Priority:** High before `phase-two-ui-makeover` is merged
**Current production impact:** None while the branch remains unreleased.

### Problem

The phase-two UI requests five separate `limit=1` leaderboards for its top-boss
cards. It also requests the selected 25-row leaderboard after bosses load, even
when the current view is not a boss page. Alongside bosses, stats, and recent
syncs, that creates at least nine database-backed calls during an initial load.

### Proposed scope

- Fetch the selected leaderboard only on a boss view.
- Replace the five top-boss requests with one cached aggregate endpoint or a
  periodically refreshed summary.
- Ensure the aggregate response contains only the fields the cards display.

### Acceptance criteria

- Home and player views do not request a hidden 25-row leaderboard.
- Top-boss cards require no more than one backend request.
- The top-boss response is shared-cacheable.
- Frontend tests lock in the reduced request count by view.

---

## Issue 4: Narrow player query result shapes

**Priority:** Low
**Expected impact:** Small egress reduction plus better data minimization.

### Problem

Player lookup routes use full-row selects even though their responses need only
the player ID, display name, and update timestamp. This transfers account hashes
and installation-secret hashes from Neon to the backend before discarding them.

### Proposed scope

- Select only `id`, `displayName`, and `updatedAt` in public player lookups.
- In sync authentication, select only the exact player fields required for
  authorization and renaming.
- Keep all account and installation-secret hashes out of logs and responses.

### Acceptance criteria

- Public player routes no longer retrieve internal hashes.
- Sync authorization and legacy secret-claim behavior remain unchanged.
- Existing player and sync tests pass.

---

## Issue 5: Reduce typeahead search requests

**Priority:** Low
**Expected impact:** Small transfer reduction; potentially useful for compute.

### Proposed scope

- Require at least two characters in both frontend and backend.
- Cancel superseded requests with `AbortController`.
- Cache recent search results for the browser session.
- Consider a trigram index only if the player table becomes large enough to
  make leading-wildcard search expensive.

### Acceptance criteria

- Zero- and one-character inputs do not query Neon.
- A superseded request cannot replace newer suggestions.
- Search remains case-insensitive and capped at ten names.

---

## Issue 6: Reduce one-off cleanup-script result transfer

**Priority:** Very low
**Expected impact:** Negligible monthly impact because the script is manual.

### Proposed scope

- Query distinct boss keys rather than every PB row.
- On deletion, return only IDs or an aggregate count instead of full rows.

This item should not delay application fixes and is not a plausible cause of
ongoing production egress.

## Measurement after deployment

- Record Neon project and production-branch transfer immediately before deploy.
- Compare hourly or daily transfer after representative plugin login activity.
- Correlate transfer with Vercel request counts for:
  - `/api/sync`
  - `/api/bosses`
  - `/api/recent-syncs`
  - `/api/stats`
  - `/api/leaderboard/*`
  - `/api/players/*`
- Check `x-vercel-cache` on cached endpoints after deployment.
- Do not log account hashes, installation secrets, database URLs, or full sync
  payloads.

## References

- Neon: <https://neon.com/docs/introduction/network-transfer>
- Vercel cache-control headers: <https://vercel.com/docs/caching/cache-control-headers>
- Vercel CDN cache: <https://vercel.com/docs/caching/cdn-cache>
