import type { Context } from 'hono';

interface SharedCachePolicy {
  maxAgeSeconds: number;
  staleWhileRevalidateSeconds: number;
}

export const cachePolicies = {
  bossList: { maxAgeSeconds: 3600, staleWhileRevalidateSeconds: 86400 },
  homeSummary: { maxAgeSeconds: 60, staleWhileRevalidateSeconds: 300 },
  liveData: { maxAgeSeconds: 30, staleWhileRevalidateSeconds: 60 },
} as const satisfies Record<string, SharedCachePolicy>;

export function setSharedCache(c: Context, policy: SharedCachePolicy) {
  // Browsers revalidate so they see the newest response available at the CDN.
  // The targeted header lets Vercel share safe public responses without every
  // request invoking the function and querying Neon.
  c.header('Cache-Control', 'public, max-age=0, must-revalidate');
  c.header(
    'CDN-Cache-Control',
    `public, max-age=${policy.maxAgeSeconds}, stale-while-revalidate=${policy.staleWhileRevalidateSeconds}`
  );
}
