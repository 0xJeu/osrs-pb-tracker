import { useEffect, useState } from 'react';

/**
 * Boss -> pet inventory sprite, per RuneDan's OSRS theme handoff
 * (INTEGRATION.md "Asset map" section). Bosses without a mapped pet fall
 * back to a text monogram in the caller.
 */
const PET_ICON_FILES: Record<string, string> = {
  'theatre of blood': "Lil' Zik.png",
  'chambers of xeric': 'Olmlet.png',
  'tombs of amascut': "Tumeken's guardian.png",
  gauntlet: 'Youngllef.png',
  'corrupted gauntlet': 'Corrupted youngllef.png',
  nightmare: 'Little nightmare.png',
  "phosani's nightmare": 'Little nightmare.png',
  inferno: 'Jal-nib-rek.png',
  'tzkal-zuk': 'Jal-nib-rek.png',
  'sol heredit': 'Smol heredit.png',
  'fortis colosseum': 'Smol heredit.png',
  'alchemical hydra': 'Ikkle hydra.png',
  araxxor: 'Nid.png',
  amoxliatl: 'Moxi.png',
  leviathan: "Lil'viathan.png",
  nex: 'Nexling.png',
  vorkath: 'Vorki.png',
  zulrah: 'Pet snakeling.png',
};

function normalize(boss: string): string {
  const lower = boss.trim().toLowerCase();
  return lower.startsWith('the ') ? lower.slice(4) : lower;
}

/** Boss -> wiki filename (no URL resolution yet). Undefined = no pet, use monogram. */
export function bossPetIconFile(boss: string): string | undefined {
  const normalized = normalize(boss);
  const match = Object.keys(PET_ICON_FILES).find((prefix) => normalized.startsWith(prefix));
  return match ? PET_ICON_FILES[match] : undefined;
}

export function bossMonogram(boss: string): string {
  const words = boss
    .replace(/\(.*?\)/g, '')
    .split(/[\s-]+/)
    .filter((w) => w && !['of', 'the', 'a'].includes(w.toLowerCase()));
  return words
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

/**
 * Resolves wiki filenames to actual thumbnail URLs via the MediaWiki
 * imageinfo API, batched and cached in memory.
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
const resolvedIconCache = new Map<string, string | null>();
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
        resolvedIconCache.set(file, info?.thumburl ?? info?.url ?? null);
      }
      for (const f of files) {
        if (!resolvedIconCache.has(f)) resolvedIconCache.set(f, null);
      }
    })
    .catch(() => {
      for (const f of files) resolvedIconCache.set(f, null);
    })
    .finally(notifySubscribers);
}

function requestIcon(file: string, pixelWidth: number) {
  if (resolvedIconCache.has(file) || pendingFiles.has(file)) return;
  batchWidth = Math.max(batchWidth, pixelWidth);
  pendingFiles.add(file);
  if (batchTimer === undefined) {
    batchTimer = window.setTimeout(runBatch, 30);
  }
}

/** React hook: resolves a boss's pet icon to a real, cacheable thumb URL. */
export function useBossPetIconUrl(boss: string, pixelWidth = 96): string | undefined {
  const file = bossPetIconFile(boss);
  const [, forceUpdate] = useState(0);

  useEffect(() => {
    if (!file) return;
    if (!resolvedIconCache.has(file)) {
      requestIcon(file, pixelWidth);
    }
    const listener = () => forceUpdate((n) => n + 1);
    subscribers.add(listener);
    return () => {
      subscribers.delete(listener);
    };
  }, [file, pixelWidth]);

  if (!file) return undefined;
  return resolvedIconCache.get(file) ?? undefined;
}
