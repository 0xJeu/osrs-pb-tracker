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
 */
export interface WikiImageResolver {
  resolvedCache: Map<string, string | null>;
  subscribers: Set<() => void>;
  request: (file: string, pixelWidth: number) => void;
}

export function createWikiImageResolver(): WikiImageResolver {
  const resolvedCache = new Map<string, string | null>();
  const pendingFiles = new Set<string>();
  const subscribers = new Set<() => void>();
  let batchTimer: number | undefined;
  let batchWidth = 96;

  function notifySubscribers() {
    subscribers.forEach((fn) => fn());
  }

  function runBatch() {
    batchTimer = undefined;
    const files = Array.from(pendingFiles);
    pendingFiles.clear();
    if (files.length === 0) return;

    const titles = files.map((f) => `File:${f}`).join('|');
    const url = `https://oldschool.runescape.wiki/api.php?action=query&titles=${encodeURIComponent(titles)}&prop=imageinfo&iiprop=url&iiurlwidth=${batchWidth}&format=json&origin=*`;

    fetch(url)
      .then((res) => res.json())
      .then((data) => {
        const pages = Object.values(data?.query?.pages ?? {}) as Array<{
          title: string;
          imageinfo?: Array<{ thumburl?: string; url?: string }>;
        }>;
        for (const page of pages) {
          const file = page.title.replace(/^File:/, '');
          const info = page.imageinfo?.[0];
          resolvedCache.set(file, info?.thumburl ?? info?.url ?? null);
        }
        for (const f of files) {
          if (!resolvedCache.has(f)) resolvedCache.set(f, null);
        }
      })
      .catch(() => {
        for (const f of files) resolvedCache.set(f, null);
      })
      .finally(notifySubscribers);
  }

  function request(file: string, pixelWidth: number) {
    if (resolvedCache.has(file) || pendingFiles.has(file)) return;
    batchWidth = Math.max(batchWidth, pixelWidth);
    pendingFiles.add(file);
    if (batchTimer === undefined) {
      batchTimer = window.setTimeout(runBatch, 30);
    }
  }

  return { resolvedCache, subscribers, request };
}

/** React hook: resolves a wiki filename to a real, cacheable thumb URL via the given resolver. */
export function useWikiImageUrl(resolver: WikiImageResolver, file: string | undefined, pixelWidth = 96): string | undefined {
  const [, forceUpdate] = useState(0);

  useEffect(() => {
    if (!file) return;
    if (!resolver.resolvedCache.has(file)) {
      resolver.request(file, pixelWidth);
    }
    const listener = () => forceUpdate((n) => n + 1);
    resolver.subscribers.add(listener);
    return () => {
      resolver.subscribers.delete(listener);
    };
  }, [resolver, file, pixelWidth]);

  if (!file) return undefined;
  return resolver.resolvedCache.get(file) ?? undefined;
}
