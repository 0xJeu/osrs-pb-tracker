import { createHash } from 'node:crypto';
import type { Context } from 'hono';

const MAX_CACHE_TAGS = 128;
const MAX_CACHE_TAG_BYTES = 256;

interface CacheLifetime {
  maxAgeSeconds: number;
  staleWhileRevalidateSeconds: number;
}

interface SharedCachePolicy extends CacheLifetime {
  // Caches in front of this backend (the website's `/api/*` rewrite is its
  // own Vercel project cache) never receive our tag purges, so they must
  // expire on their own. Their refreshes land on this backend's edge cache,
  // not on the function or Neon.
  downstream: CacheLifetime;
}

const downstreamCache: CacheLifetime = { maxAgeSeconds: 60, staleWhileRevalidateSeconds: 300 };

export const cachePolicies = {
  // Public data is identical for every visitor. Keep it at the edge for a
  // full day and invalidate the affected tags when a real sync changes data.
  // This makes read volume depend on writes, not page views.
  publicData: { maxAgeSeconds: 86400, staleWhileRevalidateSeconds: 604800, downstream: downstreamCache },
  // Negative lookups are safe to retain, but use a shorter fallback in case
  // an invalidation request ever fails after a player first syncs.
  notFound: { maxAgeSeconds: 3600, staleWhileRevalidateSeconds: 86400, downstream: downstreamCache },
} as const satisfies Record<string, SharedCachePolicy>;

function cacheControlValue(lifetime: CacheLifetime) {
  return `public, max-age=${lifetime.maxAgeSeconds}, stale-while-revalidate=${lifetime.staleWhileRevalidateSeconds}`;
}

export const cacheTags = {
  bossList: 'boss-list',
  stats: 'stats',
  recentSyncs: 'recent-syncs',
  search: 'player-search',
} as const;

function tagPart(value: string) {
  // Vercel cache tags cannot contain commas. URI encoding also gives spaces,
  // punctuation, and mixed-case player input one stable representation.
  const normalized = value.trim().toLowerCase();
  const encoded = encodeURIComponent(normalized);
  if (Buffer.byteLength(encoded, 'utf8') <= MAX_CACHE_TAG_BYTES - 32) {
    return encoded;
  }

  // Boss keys are plugin-controlled and database columns are unbounded text.
  // Hash an abnormal value instead of emitting an invalid response header.
  return `sha256-${createHash('sha256').update(normalized).digest('hex')}`;
}

export function bossCacheTag(boss: string) {
  return `boss:${tagPart(boss)}`;
}

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

// 126 PBs is the current safe ceiling: the by-id route needs 1 reserved
// slot (player-id) and the name route needs 2 (player-name + player-id),
// so reserving 2 out of Vercel's 128-tag cap keeps both routes safely under
// the limit at the same threshold. Production's current maximum is 125 PBs
// (see the design doc's evidence section), so every real profile fits today.
const MAX_EXACT_PROFILE_TAGS = MAX_CACHE_TAGS - 2;
const PROFILE_BUCKET_FALLBACK_LOG_INTERVAL = 100;
let profileBucketFallbackCount = 0;

export function profileBossExactCacheTag(boss: string) {
  return `profile-boss:${tagPart(boss)}`;
}

export function fitsExactProfileTags(pbCount: number) {
  return pbCount <= MAX_EXACT_PROFILE_TAGS;
}

export function noteProfileBucketFallback() {
  if (!process.env.VERCEL) {
    return;
  }

  profileBucketFallbackCount += 1;
  if (profileBucketFallbackCount !== 1
      && profileBucketFallbackCount % PROFILE_BUCKET_FALLBACK_LOG_INTERVAL !== 0) {
    return;
  }

  // Sampled aggregate only: never include a player ID, account hash, display
  // name, boss list, credential, or request payload in retained platform logs.
  console.info('Oversized profile cache bucket fallback', {
    fallbackResponses: profileBucketFallbackCount,
  });
}

export function resetProfileBucketFallbackMetric() {
  profileBucketFallbackCount = 0;
}

export function playerIdCacheTag(playerId: number) {
  return `player-id:${playerId}`;
}

export function playerNameCacheTag(displayName: string) {
  return `player-name:${tagPart(displayName)}`;
}

export function setSharedCache(c: Context, policy: SharedCachePolicy, tags: readonly string[] = []) {
  // Browsers revalidate so they see the newest response available at the CDN.
  // Vercel-CDN-Cache-Control is consumed by this project's edge (the long,
  // tag-purged cache that keeps requests off the function and Neon) and is
  // stripped before the response leaves it. CDN-Cache-Control is what
  // downstream caches such as the website's rewrite proxy then honor.
  c.header('Cache-Control', 'public, max-age=0, must-revalidate');
  c.header('Vercel-CDN-Cache-Control', cacheControlValue(policy));
  c.header('CDN-Cache-Control', cacheControlValue(policy.downstream));

  const uniqueTags = [...new Set(tags)].slice(0, MAX_CACHE_TAGS);
  if (uniqueTags.length > 0) {
    // Vercel consumes this header before sending the response to visitors.
    c.header('Vercel-Cache-Tag', uniqueTags.join(','));
  }
}

export async function invalidateSharedCache(tags: readonly string[]) {
  const uniqueTags = [...new Set(tags)];
  if (uniqueTags.length === 0 || !process.env.VERCEL) {
    return;
  }

  try {
    // Cache-tag invalidation is available on every Vercel plan. A literal
    // dynamic import keeps local/test execution independent of Vercel while
    // still allowing the deployment bundler to include the package.
    const { invalidateByTag } = await import('@vercel/functions');
    for (let i = 0; i < uniqueTags.length; i += MAX_CACHE_TAGS) {
      await invalidateByTag(uniqueTags.slice(i, i + MAX_CACHE_TAGS));
    }
  } catch (error) {
    // A cache purge must never turn a successful database write into a failed
    // plugin sync. The long TTL remains a safe fallback and the warning gives
    // deployment logs enough evidence to investigate.
    console.warn('Unable to invalidate Vercel cache tags', error);
  }
}
