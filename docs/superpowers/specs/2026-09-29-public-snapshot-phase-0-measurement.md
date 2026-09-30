# Public Snapshot Phase 0 Measurement

Date: 2026-09-29 America/Chicago (production queries completed 2026-09-30 UTC)

Status: measurement complete; no Redis resource, database migration, deployment, or production write performed.

## Decision supported by the measurements

The proposed single-value public snapshot fits Upstash Redis Free with large present-day headroom. Proceed to implementation preparation with Brotli plus base64 encoding, one atomic snapshot value, and Neon fallback. Do not provision production Redis until the implementation branch and exact Marketplace settings are ready for review.

Use AWS `us-east-1` for Upstash. A live production response reported `x-vercel-id: cle1::iad1::...`; `iad1` is the executing Vercel Function region. Production Neon remains in `aws-us-east-2`, but Redis will serve the normal read path and should be colocated with the Function.

## Source of truth

- Neon project: `snowy-fire-96856162` (`osrs-pb-tracker`)
- Branch: `br-plain-leaf-aja8iam5` (`main`, default)
- Database: `neondb`
- Query mode: read-only SQL through the explicit Neon project and branch
- Repository baseline: `fork/dev` at `569881d9a5c5e65c695d29105f4af18a9f8f4a2e`
- Measurement worktree: `worktrees/pbt-public-snapshot-phase0`

The local `backend-hono/.env` is not production; it returned 10 players and 28 PBs and was excluded from production capacity conclusions. The isolated `.env.test` branch was empty and was retained only as an empty-bootstrap check.

## Current production population

| Measure | Count |
|---|---:|
| Players | 268 |
| Historical-name rows | 11 |
| Personal-best rows | 8,105 |
| Distinct boss keys | 173 |
| Lookup names | 278 |
| Ambiguous lookup names | 0 |
| Maximum players matched by one current/historic name | 1 |

The snapshot still stores an array for every name lookup so ambiguity remains representable if it appears later.

## Exact snapshot contents

The measured snapshot contains only existing public API data:

- schema version, generated timestamp, and measurement revision;
- aggregate source counts;
- sorted boss list;
- current and historical normalized-name to player-ID index;
- every public player profile;
- every PB with boss, seconds, update time, and globally computed rank.

It excludes account hashes, installation credentials and digests, recovery records/codes, sync-attempt records, administrative state, IP information, and feedback.

Ranks were computed with `RANK() OVER (PARTITION BY boss ORDER BY time_seconds)`. That matches the current route definition: one plus the number of strictly faster rows, including tied-time behavior.

## Size measurements

| Representation | Bytes | MiB | Share of raw |
|---|---:|---:|---:|
| Raw JSON | 1,044,499 | 0.996 | 100% |
| gzip level 9 | 95,495 | 0.091 | 9.14% |
| Brotli binary | 71,071 | 0.068 | 6.80% |
| Brotli encoded as base64 | 94,764 | 0.090 | 9.07% |
| Estimated Redis `SET` request | 94,804 | 0.090 | 9.08% |

The estimated Redis request is approximately **1.2% of Upstash's 10 MB request limit** and the record is approximately **0.04% of the 256 MB Free storage allowance**. The snapshot is also far below the 100 MB record limit.

Component sizes show that future sharding is possible but unnecessary at current traffic:

| Component | p50 encoded | p95 encoded | max encoded | total encoded |
|---|---:|---:|---:|---:|
| Individual player profile, Brotli + base64 | 568 B | 2,064 B | 2,244 B | 187,156 B |
| Complete name index, Brotli + base64 | — | — | 2,844 B | 2,844 B |
| Boss list, Brotli + base64 | — | — | 1,052 B | 1,052 B |

The single-value design transfers more data per cache miss but needs one read command and one atomic publication. A generation-sharded design would reduce read bandwidth but require roughly 271 writes for each publication. Current measurements favor the simpler single-value design.

## Timing measurements

| Operation | Result |
|---|---:|
| Complete snapshot SQL execution, warm production buffers | 256.509 ms |
| SQL planning | 4.451 ms |
| Shared blocks read from disk during measured build | 0 |
| Local Brotli decode + JSON parse p50, 200 runs | 3.672 ms |
| Local Brotli decode + JSON parse p95, 200 runs | 5.167 ms |
| Local maximum in the 200-run sample | 6.448 ms |

The SQL measurement generated the complete 1.04 MB JSON document and reported 4,495 shared-buffer hits. The observed first request will also include Neon wake/network time; the builder itself is not the expensive part.

## Response-equivalence evidence

- All 8,105 snapshot PB ranks matched an independent SQL rank calculation.
- Every PB referenced an existing public player.
- Every historical-name record referenced an existing public player.
- Twelve deterministic live `/api/players/by-id/:id` samples matched the generated snapshot after ISO timestamp normalization.
- The sample covered profiles from 0 through 123 PB rows and included historical-name cases.
- All twelve live requests returned HTTP 200 and all twelve were Vercel cache `MISS` responses in the measurement region, directly reproducing the cache-miss condition that currently reaches Neon.
- The empty isolated test branch produced a valid empty snapshot and matched its independent reference query.

Phase 1 should turn these comparisons into repeatable automated tests before any primary-mode rollout.

## Measured publication rate

Production `sync_attempts` for the last 30 days recorded:

- 362 accepted attempts;
- 355 attempts with at least one public PB mutation;
- 1,602 PB rows updated;
- 30 public mutations in the latest 72 hours;
- 882 installation-secret mismatches in the prior portion of the window, with zero public mutations.

Only the 355 actual public mutations would publish a new public snapshot. Rejections and accepted no-ops must not publish one.

## Free-plan command and bandwidth projection

Assumptions:

- encoded Redis payload: 94,804 bytes;
- relevant origin misses from the 72-hour capture: 177/month-scaled to 1,770;
- observed public mutations: 355 per 30 days;
- one Redis command per read and one atomic publication command per mutation;
- transfer conservatively charges the full payload for both reads and writes;
- Free allowances: 500,000 commands and 10 GB (decimal) monthly bandwidth.

| Scenario | Reads/mo | Publishes/mo | Commands | Command allowance | Transfer | Bandwidth allowance |
|---|---:|---:|---:|---:|---:|---:|
| Current relevant misses | 1,770 | 355 | 2,125 | 0.425% | 201.5 MB | 2.02% |
| Every captured request reaches Redis | 10,730 | 355 | 11,085 | 2.217% | 1,050.9 MB | 10.51% |
| 10x relevant traffic and mutations | 17,700 | 3,550 | 21,250 | 4.25% | 2,014.6 MB | 20.15% |
| 10x all captured traffic, 10x mutations | 107,300 | 3,550 | 110,850 | 22.17% | 10,509.0 MB | 105.09% |

Current use is comfortably inside Free. The limiting resource is bandwidth, not commands or storage. The pessimistic “all captured traffic at 10x” case exceeds the bandwidth ceiling, so production monitoring should alert at 70% and retain the option to shard player profiles or move to Pay-as-you-go.

## Expected Neon effect

The earlier 72-hour capture attributed about 73% of awake time to player-profile and boss-list cache misses. Removing those wakes should reduce steady-state usage from the projected 83–94 CU-hours/month to approximately 25–35 CU-hours/month after allowing for sync writes, admin activity, controlled fallbacks, and uncertainty. This is a projection to validate after rollout; it is not yet a reason to downgrade Neon.

The live equivalence check reinforced the mechanism: 12 of 12 representative profile requests were regional CDN misses even though the responses are cacheable.

## Architecture refinements from Phase 0

1. Keep the single Brotli + base64 snapshot for the first rollout. Its 94.8 KB request is small enough and substantially simpler to publish atomically than 268 profile keys.
2. Set a hard encoded-size deployment gate at 2 MB and an alert at 1 MB. The current payload has about 21x room before the deployment gate.
3. Publish only after a committed public mutation. Rejections, recovery probes, and accepted no-ops do not rebuild.
4. Keep a monotonic database revision and atomic compare-and-set publisher. Size fit does not remove stale-writer risk.
5. Use Upstash AWS `us-east-1`, matching the verified `iad1` backend execution region.
6. Keep Vercel CDN in front with Redis on origin misses and Neon only for controlled fallback.
7. Retain a sharded generation design as the documented escape hatch if bandwidth reaches 70% of the allowance or the encoded snapshot reaches 1 MB.

## Phase 0 exit gate

Phase 0 passes for capacity and semantic feasibility:

- production dataset explicitly verified;
- exact snapshot below request, record, and storage limits;
- current and 10x-relevant projections below Free allowances;
- rank and route response samples equivalent;
- build and decode latency acceptable;
- region placement verified;
- no production writes or infrastructure changes performed.

The next reviewable step is Phase 1 code preparation in this worktree: extract the snapshot schema/builder into tested modules, implement the Redis configuration/store interface behind `PUBLIC_READ_MODEL_MODE=disabled`, and prepare the Marketplace resource settings. Provision production Redis only after that branch is reviewed.
