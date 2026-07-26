import { createHash } from 'node:crypto';
import { getCache } from '@vercel/functions';

const SYNC_REPLAY_TTL_SECONDS = 10 * 60;
// v2: bumped from v1 when player-scoped tags were introduced. Vercel Runtime
// Cache persists across deployments and does not retroactively add tags to
// entries written by older code, so a version bump (which also changes the
// underlying namespace) is required to guarantee every live entry has a
// player tag - otherwise pre-deploy entries could dodge player-scoped
// invalidation for the remainder of their TTL. Bump again if the tagging
// scheme changes further.
const SYNC_REPLAY_TAG = 'pb-sync-replay-v2';
const REPLAY_METRIC_INTERVAL_MS = 60 * 1000;
let replayHitsSinceMetric = 0;
let lastReplayMetricAt = 0;

interface CachedSyncResult {
  playerId: number;
  received: number;
}

// The fingerprint is already a SHA-256 digest, so preserve it instead of
// letting the runtime cache collapse it to its much shorter default hash.
// In production this cache is shared across Vercel function instances; local
// and test runs transparently use @vercel/functions' in-memory fallback.
const syncReplayCache = getCache({
  namespace: SYNC_REPLAY_TAG,
  keyHashFunction: (key) => key,
});

function playerReplayTag(playerId: number) {
  return `${SYNC_REPLAY_TAG}-player-${playerId}`;
}

function fingerprintValue(value: unknown) {
  const numeric = Number(value);
  if (Number.isNaN(numeric)) {
    return 'NaN';
  }
  if (Object.is(numeric, -0)) {
    return '-0';
  }
  return String(numeric);
}

/**
 * Builds a credential-safe, order-independent identity for one sync request.
 * Only the final digest is used as a cache key; account hashes, install
 * secrets, display names, boss keys, and times are never stored in the cache.
 */
export function buildSyncReplayKey(values: {
  accountHash: string;
  displayName: string;
  secretHash: string;
  entries: Array<[string, unknown]>;
}) {
  const normalizedEntries = values.entries
    .map(([boss, seconds]) => [boss.trim().toLowerCase(), fingerprintValue(seconds)] as const)
    .sort(([leftBoss, leftSeconds], [rightBoss, rightSeconds]) => {
      if (leftBoss !== rightBoss) {
        return leftBoss < rightBoss ? -1 : 1;
      }
      return leftSeconds === rightSeconds ? 0 : leftSeconds < rightSeconds ? -1 : 1;
    });

  return createHash('sha256')
    .update(JSON.stringify([
      values.accountHash,
      values.displayName,
      values.secretHash,
      normalizedEntries,
    ]))
    .digest('hex');
}

function isCachedSyncResult(value: unknown): value is CachedSyncResult {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<CachedSyncResult>;
  return Number.isInteger(candidate.playerId)
    && (candidate.playerId ?? 0) > 0
    && Number.isInteger(candidate.received)
    && (candidate.received ?? -1) >= 0;
}

export async function getSuccessfulSyncReplay(key: string) {
  try {
    const cached = await syncReplayCache.get(key);
    return isCachedSyncResult(cached) ? cached : null;
  } catch (error) {
    // Replay protection is an optimization and emergency load-shedder, not a
    // correctness dependency. A cache outage must not block a legitimate PB.
    console.warn('Unable to read PB sync replay cache', {
      error: error instanceof Error ? error.message : 'unknown error',
    });
    return null;
  }
}

export async function rememberSuccessfulSync(key: string, result: CachedSyncResult) {
  try {
    await syncReplayCache.set(key, result, {
      ttl: SYNC_REPLAY_TTL_SECONDS,
      // The player-specific tag lets a recovery capture/promotion evict only
      // this player's cached replay entries instead of the whole namespace -
      // a global clear would otherwise be a public, unauthenticated way to
      // evict every player's replay protection via repeated install-secret
      // mismatches.
      tags: [SYNC_REPLAY_TAG, playerReplayTag(result.playerId)],
      // The key is already opaque, but suppress its display in cache o11y too.
      name: '',
    });
  } catch (error) {
    // A successful database sync stays successful even if replay protection
    // cannot be populated for the next request.
    console.warn('Unable to write PB sync replay cache', {
      error: error instanceof Error ? error.message : 'unknown error',
    });
  }
}

export function noteSuccessfulSyncReplay(nowMs: number = Date.now()) {
  if (!process.env.VERCEL) {
    return;
  }

  replayHitsSinceMetric += 1;
  if (lastReplayMetricAt !== 0 && nowMs - lastReplayMetricAt < REPLAY_METRIC_INTERVAL_MS) {
    return;
  }

  // One aggregate counter per warm instance/minute proves the production
  // bypass is active without logging players, accounts, credentials, or PBs.
  console.info('PB sync replay protection active', {
    deduplicatedRequests: replayHitsSinceMetric,
  });
  replayHitsSinceMetric = 0;
  lastReplayMetricAt = nowMs;
}

export async function resetSyncReplayCache() {
  await syncReplayCache.expireTag(SYNC_REPLAY_TAG);
}

// Invalidates only one player's cached replay entries - used when a recovery
// candidate is captured or promoted, so that action can't be abused as a
// public way to evict every player's replay protection. Never throws: a
// database mutation (candidate capture, promotion) must not be reported as
// failed just because the follow-up cache invalidation had trouble. Returns
// whether it actually succeeded so callers for whom invalidation is a
// correctness dependency (not just an optimization) can react - see
// captureInstallRecoveryCandidate, which must not leave a candidate
// "pending"/promotable on unconfirmed invalidation.
export async function invalidatePlayerSyncReplay(playerId: number): Promise<boolean> {
  try {
    await syncReplayCache.expireTag(playerReplayTag(playerId));
    return true;
  } catch (error) {
    console.warn('Unable to invalidate PB sync replay cache for player', {
      playerId,
      error: error instanceof Error ? error.message : 'unknown error',
    });
    return false;
  }
}
