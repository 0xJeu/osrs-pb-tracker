import { useEffect, useState } from 'react';

/**
 * Resolves OSRS Wiki filenames to actual thumbnail URLs via the MediaWiki
 * imageinfo API, batched and cached in memory. Shared by every "boss -> wiki
 * image" lookup on the site (pet icons, boss portrait icons, ...) so each
 * gets its own independent cache/batch window without re-implementing this
 * plumbing per source.
 *
 * Source files on the wiki vary wildly in native resolution (some pet icons
 * are ~27px stills, others are >1500px full renders), and hotlinking
 * /images/<file> directly serves whatever resolution the source happens to
 * be. Special:FilePath?width=N normalizes that server-side, but its
 * redirect hop is marked non-cacheable - fine for one icon, but a leaderboard
 * page renders the same boss icon 10-25+ times, and that many uncached
 * redirects in parallel stalls out well before they all resolve.
 * The imageinfo API instead returns the final, CDN-cached thumb URL
 * directly, and this cache means a boss's icon is resolved with a single
 * network round-trip no matter how many rows render it.
 *
 * The cache is also persisted to localStorage, so that round-trip happens
 * about once a month per visitor instead of once per page load. The filename
 * lists that feed this are static and hand-maintained, so a resolved thumb URL
 * stays good essentially forever - re-asking the wiki on every visit is load on
 * their API that buys nobody anything.
 */

const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * One canonical thumbnail width for every lookup, rather than a per-caller
 * width. The previous `Math.max(batchWidth, pixelWidth)` ratchet meant the
 * width we asked for depended on which consumer rendered first, so the same
 * image could be requested at two different sizes across sessions - splitting
 * the wiki's thumbnail cache for no visual gain.
 */
const THUMB_WIDTH = 128;

type PersistedEntry = { url: string; ts: number };
export interface WikiImageResolver {
  resolvedCache: Map<string, string | null>;
  subscribers: Set<() => void>;
  request: (file: string) => void;
}

/**
 * @param cacheKey distinguishes this resolver's persisted cache from every
 *   other resolver's, so pet icons and portrait icons don't overwrite each other.
 */
export function createWikiImageResolver(cacheKey: string): WikiImageResolver {
  const storageKey = `pbt:wiki-images:${cacheKey}:v1`;
  const resolvedCache = new Map<string, string | null>();
  // When each URL was actually resolved against the wiki. Kept per entry so that
  // writing one new resolution doesn't renew every other entry's TTL.
  const resolvedAt = new Map<string, number>();
  const pendingFiles = new Set<string>();
  const subscribers = new Set<() => void>();
  let batchTimer: number | undefined;

  // Every storage access is guarded: it throws or returns empty in private
  // mode, with site data blocked, and during SSR/prerender.
  try {
    const raw = typeof window !== 'undefined' ? window.localStorage.getItem(storageKey) : null;
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, PersistedEntry>;
      const now = Date.now();
      for (const [file, entry] of Object.entries(parsed)) {
        if (entry && typeof entry.url === 'string' && now - entry.ts < CACHE_TTL_MS) {
          resolvedCache.set(file, entry.url);
          resolvedAt.set(file, entry.ts);
        }
      }
    }
  } catch {
    /* fall back to resolving over the network */
  }

  /**
   * Persists successful resolutions only. A null stays in memory so it isn't
   * re-requested this page load, but is not written: a transient wiki blip
   * shouldn't cost a visitor their icons for the next 30 days.
   *
   * Each entry keeps the time it was actually resolved. Stamping everything with
   * `now` here would renew every old entry whenever any new icon resolved, so the
   * TTL would never expire for a returning visitor - and a stale thumb URL (the
   * wiki re-uploaded the file) would render as a broken image indefinitely.
   */
  function persist() {
    try {
      if (typeof window === 'undefined') return;
      const now = Date.now();
      const out: Record<string, PersistedEntry> = {};
      for (const [file, url] of resolvedCache) {
        if (typeof url === 'string') out[file] = { url, ts: resolvedAt.get(file) ?? now };
      }
      window.localStorage.setItem(storageKey, JSON.stringify(out));
    } catch {
      /* storage full or unavailable - the in-memory cache still works */
    }
  }

  function notifySubscribers() {
    subscribers.forEach((fn) => fn());
  }

  function runBatch() {
    batchTimer = undefined;
    const files = Array.from(pendingFiles);
    pendingFiles.clear();
    if (files.length === 0) return;

    const titles = files.map((f) => `File:${f}`).join('|');
    const url = `https://oldschool.runescape.wiki/api.php?action=query&titles=${encodeURIComponent(titles)}&prop=imageinfo&iiprop=url&iiurlwidth=${THUMB_WIDTH}&format=json&origin=*`;

    fetch(url)
      .then((res) => res.json())
      .then((data) => {
        const pages = Object.values(data?.query?.pages ?? {}) as Array<{
          title: string;
          imageinfo?: Array<{ thumburl?: string; url?: string }>;
        }>;
        const resolvedNow = Date.now();
        for (const page of pages) {
          const file = page.title.replace(/^File:/, '');
          const info = page.imageinfo?.[0];
          const url = info?.thumburl ?? info?.url ?? null;
          resolvedCache.set(file, url);
          if (url) resolvedAt.set(file, resolvedNow);
        }
        for (const f of files) {
          if (!resolvedCache.has(f)) resolvedCache.set(f, null);
        }
        persist();
      })
      .catch(() => {
        // Deliberately no retry: a failed lookup costs a placeholder, and
        // retrying against someone else's API on our users' behalf is how a
        // wiki blip becomes a wiki outage.
        for (const f of files) resolvedCache.set(f, null);
      })
      .finally(notifySubscribers);
  }

  function request(file: string) {
    if (resolvedCache.has(file) || pendingFiles.has(file)) return;
    pendingFiles.add(file);
    if (batchTimer === undefined) {
      batchTimer = window.setTimeout(runBatch, 30);
    }
  }

  return { resolvedCache, subscribers, request };
}

/** React hook: resolves a wiki filename to a real, cacheable thumb URL via the given resolver. */
export function useWikiImageUrl(resolver: WikiImageResolver, file: string | undefined): string | undefined {
  const [, forceUpdate] = useState(0);

  useEffect(() => {
    if (!file) return;
    if (!resolver.resolvedCache.has(file)) {
      resolver.request(file);
    }
    const listener = () => forceUpdate((n) => n + 1);
    resolver.subscribers.add(listener);
    return () => {
      resolver.subscribers.delete(listener);
    };
  }, [resolver, file]);

  if (!file) return undefined;
  return resolver.resolvedCache.get(file) ?? undefined;
}
