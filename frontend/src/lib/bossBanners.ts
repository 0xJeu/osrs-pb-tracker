const WIKI_IMAGE_BASE = 'https://oldschool.runescape.wiki/images/';

const BOSS_BANNERS: Record<string, string> = {
  'theatre of blood': 'Theatre_of_Blood_artwork.jpg',
  'chambers of xeric': 'Chambers_of_Xeric_artwork.jpg',
  'tombs of amascut': 'Tombs_of_Amascut_%281%29.jpg',
  inferno: 'TzKal-Zuk_artwork.jpg',
  'fortis colosseum': 'Fortis_Colosseum_-_colossi_concept_art.jpg',
};

function normalize(boss: string): string {
  const lower = boss.trim().toLowerCase();
  return lower.startsWith('the ') ? lower.slice(4) : lower;
}

export function bossBannerUrl(boss: string): string | undefined {
  const normalized = normalize(boss);
  const prefix = Object.keys(BOSS_BANNERS).find((candidate) => normalized.startsWith(candidate));
  return prefix ? `${WIKI_IMAGE_BASE}${BOSS_BANNERS[prefix]}` : undefined;
}
