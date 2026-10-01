# Negative-cache rollout and positive-authorization gate

## Scope

This follow-up to PR #54 suppresses repeated known sync denials and repeated
nonexistent-player lookups. It does not authorize requests from Redis. The
successful-sync path retains its existing Neon credential transaction.

September 30's measured post-cutover window had 14 production starts:
three started with real PB changes, six with authorized unchanged syncs,
and five were unclassified because the route logs had expired. Those six
unchanged-success starts remain the primary savings opportunity after this
denial-only stage. No recorded credential rejections occurred in that window;
do not project denial-cache savings from those six starts.

## Provider decision

Upstash's current [consistency documentation](https://upstash.com/docs/redis/features/consistency)
states that replication is eventual and that strong-consistency mode was
deprecated. Its [primary-read technique](https://upstash.com/blog/replicated-cache-backed-by-redis)
uses EVAL to avoid ordinary replica reads, but that does not by itself prove
the required behavior across split-brain reconciliation, acknowledged-write
loss, or restoration of an old authorization generation. Atomic scripts
are useful for fencing fills, but are not a complete cross-store revocation
protocol.

The previous vault provider-decision paragraph claiming that script support
alone resolved positive authorization is superseded by this finding.

For an active credential, a cached no-op decision must not linearize after
completed revocation. No successful Redis fast path is enabled in this change.
Do not remove `isSuccessfulSyncReplayAuthorized`, extend the successful replay
TTL, or remove the guarded write transaction as a shortcut.

The approved infrastructure remains Neon, Vercel, and Upstash Redis. No
additional provider or credential coordinator is part of this change. The
unapproved separate-provider implementation has been removed at Steph's request.
Successful unchanged syncs still use the existing Neon authorization check;
their safe Redis-only optimization remains unfinished. Do not describe this
negative-cache phase as eliminating those successful-sync wakeups.

## Implemented request behavior

* Malformed sync: existing validation before any cache/database lookup.
* Warm exact pending, contested, rejected, or revoked denial: existing 409
  fields, `syncAttemptId: null`, no Neon queries or attempt-count writes.
* Different account, installation, display name, or submitted payload:
  existing exact-request fingerprint differs, so use normal guarded resolution.
* Incomplete invalidation/capture errors: not cached.
* Missing/expired/corrupt cache or timeout: existing database path.
* Known snapshot profile: snapshot wins before negative lookup.
* A previously DB-confirmed absent name or ID: cached 404 without Neon.
* First unknown name or ID: database confirmation is still required. This
  change does not eliminate wakeups from a stream of distinct random names.
* Initial account creation/rename: rotate missing-player generation.
* Approve, replace, revoke, reactivate, reject, reopen, resolve contest:
  rotate denial generation before and after the existing transaction, including
  failure. Old generation fills are rejected by the publication script.

The existing request rate limiter remains in force. This change does not
claim global cache-miss load shedding or single-flight database hydration.
Those require a separate measured design; no new periodic Neon reads exist.

## Bounded stale denial and audit semantics

Each Redis record has a five-minute provider TTL plus an absolute expiry
checked by the reader. Each class has an atomic admission index capped at
2,048 records during normal primary operation. Keys use hashed exact-request
or name/ID fingerprints; no raw secret or credential digest is stored.

An approval may temporarily encounter a stale denial during replication or
an invalidation outage, bounded by the record's absolute expiry. This is a
denial-only availability tradeoff; it can never grant revoked access. The
existing CDN's not-found TTL/stale policy is unchanged and can outlive the
Redis entry. Do not describe five minutes as an end-to-end CDN freshness SLA.

Generation rotation is best effort: failures preserve the committed admin
decision, log a sanitized sampled warning, and let negative records expire.
This behavior is deliberately unsuitable for positive authorization.

Warm denials no longer produce a new `sync_attempts` row, recovery continuity
comparison, or attempt-count increment. The first discovery and meaningful
admin decisions remain durable. Attempt counts represent database-processed
attempts, not every network request. Do not pass an old audit ID off as a new
attempt; cached responses explicitly use `syncAttemptId: null`.

## Configuration and rollout

Flags default off:

```
SYNC_DENIAL_CACHE_ENABLED=false
PUBLIC_NEGATIVE_CACHE_ENABLED=false
```

Reuse the backend-only Redis URL/token adapter and explicit
`PUBLIC_READ_MODEL_NAMESPACE`. Keys are under
`<namespace>:negative:v1:sync-denial:*` and
`<namespace>:negative:v1:player-missing:*`, separate from the public snapshot.
Preview/test must use a separate namespace and explicit test credentials;
provider checks may use disposable synthetic keys on the existing approved Redis
resource without accessing snapshot/player keys. Never
connect the frontend or plugin to Redis.

1. Validate offline/unit tests and guarded database integration tests.
2. Run `scripts/check-negative-cache-store.ts` against UUID-isolated scratch keys
   using explicitly selected Redis credentials in `NEGATIVE_CACHE_TEST_REDIS_URL` and
   `NEGATIVE_CACHE_TEST_REDIS_TOKEN`. The script uses only synthetic records
   and deletes its exact keys. It verifies two-client publication, cardinality,
   delayed-fill rejection, malformed records, and missing control.
3. Commit/review through dev, enable one flag in isolated preview/staging,
   and verify denial/admin-transition behavior and zero Neon calls explicitly.
4. Promote reviewed code, then enable one production flag at a time. Preserve
   capture of request logs to measure origin misses, denials, and real writes.
5. Rollback by setting either flag false and redeploying. No schema rollback
   or cache deletion is required; positive authorization never moved.

## Remaining work

The main target remains successful unchanged syncs. Design and validate revocation-safe
Redis-only credential caching within the approved infrastructure,
then move last-seen activity to cache and flush it only while Neon is already
awake for legitimate work. Do not add a scheduled flush that wakes Neon.
Keep real PB/name writes guarded in the existing database transaction.

This branch has no production configuration changes or migration. Plan changes
still require representative actual CU-hour usage, not only active-time estimates.


## Release validation checkpoint

The Redis-only release branch is `codex/redis-negative-release`, based directly
on `fork/dev`, with none of the removed provider commits in its ancestry.
Actual two-client Upstash validation passed all six checks against disposable
UUID-isolated keys on the existing approved resource; exact keys were deleted.
That validation found a Lua JSON-scalar corruption edge case, fixed by checking
`type(entry) == 'table'` before accessing its generation.
An opt-in guarded test (`NEGATIVE_CACHE_LIVE_TEST=true`) uses an isolated Redis
namespace and the verified Neon test branch to verify warm zero-query denials,
reject/reopen/promote invalidation and missing-name creation invalidation. It
must never run against a production Neon branch. Default CI skips live-provider
cases; ordinary guarded/unit tests remain required.
