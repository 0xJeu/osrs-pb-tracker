import { createHash } from 'node:crypto';
import type { Context } from 'hono';

const MAX_CACHE_TAGS = 128;
const MAX_CACHE_TAG_BYTES = 256;

interface SharedCachePolicy {
  maxAgeSeconds: number;
  staleWhileRevalidateSeconds: number;
}

export const cachePolicies = {
  // Public data is identical for every visitor. Keep it at the edge for a
  // full day and invalidate the affected tags when a real sync changes data.
  // This makes read volume depend on writes, not page views.
  publicData: { maxAgeSeconds: 86400, staleWhileRevalidateSeconds: 604800 },
  // Negative lookups are safe to retain, but use a shorter fallback in case
  // an invalidation request ever fails after a player first syncs.
  notFound: { maxAgeSeconds: 3600, staleWhileRevalidateSeconds: 86400 },
} as const satisfies Record<string, SharedCachePolicy>;

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

export function playerIdCacheTag(playerId: number) {
  return `player-id:${playerId}`;
}

export function playerNameCacheTag(displayName: string) {
  return `player-name:${tagPart(displayName)}`;
}

export function setSharedCache(c: Context, policy: SharedCachePolicy, tags: readonly string[] = []) {
  // Browsers revalidate so they see the newest response available at the CDN.
  // The targeted header lets Vercel share safe public responses without every
  // request invoking the function and querying Neon.
  c.header('Cache-Control', 'public, max-age=0, must-revalidate');
  c.header(
    'CDN-Cache-Control',
    `public, max-age=${policy.maxAgeSeconds}, stale-while-revalidate=${policy.staleWhileRevalidateSeconds}`
  );

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
    await invalidateByTag(uniqueTags);
  } catch (error) {
    // A cache purge must never turn a successful database write into a failed
    // plugin sync. The long TTL remains a safe fallback and the warning gives
    // deployment logs enough evidence to investigate.
    console.warn('Unable to invalidate Vercel cache tags', error);
  }
}
