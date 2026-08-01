import { createWikiImageResolver, useWikiImageUrl } from './wikiImageResolver';

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
  'phantom muspah': 'Muphin.png',
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

const resolver = createWikiImageResolver();

/** React hook: resolves a boss's pet icon to a real, cacheable thumb URL. */
export function useBossPetIconUrl(boss: string, pixelWidth = 96): string | undefined {
  return useWikiImageUrl(resolver, bossPetIconFile(boss), pixelWidth);
}
