/**
 * Boss -> local icon file, served from /public/boss-icons/. These are the
 * exact same 26x26 PNGs the RuneLite plugin bundled at one point (see
 * pb-tracker-sync commit 20dde34, "Add real boss icons from the OSRS Wiki
 * to My PBs and Bosses tabs") before it switched to fetching sprites live
 * from RuneLite's own game-cache SpriteManager - a website has no
 * equivalent live API, so these bundled files (recovered from that commit
 * and copied into this repo's public/ folder) are the real fix, not a
 * substitute. Slug/alias logic below is a straight port of the plugin's
 * own BossIcons.java, so a boss key resolves to the same icon on both
 * sides. A boss with no entry (a few very recently added ones not in that
 * bundle) falls back to a text monogram in the caller.
 */
const ALIASES: Record<string, string> = {
  'duke_sucellus_(awakened)': 'duke_sucellus',
  'leviathan_(awakened)': 'leviathan',
  'vardorvis_(awakened)': 'vardorvis',
  'whisperer_(awakened)': 'whisperer',
  demonic_brutus: 'brutus',
  sol_heredit: 'fortis_colosseum',
  tzkal_zuk: 'inferno',
  fight_caves: 'tzhaar_fight_cave',
  "tzhaar_ket_raks_challenges": 'tztok_jad',
  tzhaar_ket_raks_first_challenge: 'tztok_jad',
  tzhaar_ket_raks_second_challenge: 'tztok_jad',
  tzhaar_ket_raks_third_challenge: 'tztok_jad',
  tzhaar_ket_raks_fourth_challenge: 'tztok_jad',
  tzhaar_ket_raks_fifth_challenge: 'tztok_jad',
  tzhaar_ket_raks_sixth_challenge: 'tztok_jad',
};

const AVAILABLE_ICONS = new Set([
  'abyssal_sire', 'alchemical_hydra', 'amoxliatl', 'araxxor', 'artio',
  'barbarian_assault', 'brutus', 'bryophyta', 'callisto', 'calvarion',
  'cerberus', 'chambers_of_xeric', 'chaos_elemental', 'chaos_fanatic',
  'commander_zilyana', 'corporeal_beast', 'corrupted_gauntlet',
  'crazy_archaeologist', 'dagannoth_prime', 'dagannoth_rex',
  'dagannoth_supreme', 'deranged_archaeologist', 'duke_sucellus',
  'fortis_colosseum', 'fragment_of_seren', 'galvek', 'gauntlet',
  'general_graardor', 'giant_mole', 'grotesque_guardians',
  'guardians_of_the_rift', 'hallowed_sepulchre', 'hespori', 'hueycoatl',
  'inferno', 'kalphite_queen', 'king_black_dragon', 'kraken', 'kreearra',
  'kril_tsutsaroth', 'leviathan', 'maggot_king', 'mimic', 'nex',
  'nightmare', 'obor', 'phantom_muspah', 'phosanis_nightmare',
  'royal_titans', 'sarachnis', 'scorpia', 'scurrius', 'shellbane_gryphon',
  'skotizo', 'spindel', 'tempoross', 'theatre_of_blood',
  'thermonuclear_smoke_devil', 'tombs_of_amascut', 'tzhaar_fight_cave',
  'tzhaar_ket_raks_first_challenge', 'tzhaar_ket_raks_fourth_challenge',
  'tzhaar_ket_raks_second_challenge', 'tzhaar_ket_raks_third_challenge',
  'tztok_jad', 'vardorvis', 'venenatis', 'vetion', 'vorkath', 'whisperer',
  'wintertodt', 'yama', 'zalcano', 'zulrah',
]);

/** Same normalization as the plugin's BossIcons.slugFor() - strips a " - " mode/size suffix and a leading "the ". */
function slugFor(bossKey: string): string | undefined {
  if (!bossKey || !bossKey.trim()) return undefined;
  let base = bossKey.trim().toLowerCase();
  const dash = base.indexOf(' - ');
  if (dash >= 0) base = base.slice(0, dash);
  if (base.startsWith('the ')) base = base.slice(4);
  return base.replace(/'/g, '').replace(/ /g, '_').replace(/-/g, '_');
}

/** Boss -> local icon path, or undefined if there's no bundled icon for it (caller shows a monogram). */
export function bossIconFile(boss: string): string | undefined {
  const slug = slugFor(boss);
  if (!slug) return undefined;
  const resolved = ALIASES[slug] ?? slug;
  return AVAILABLE_ICONS.has(resolved) ? `/boss-icons/${resolved}.png` : undefined;
}

/**
 * No async resolution needed - these are static local files, not fetched
 * from the wiki. `pixelWidth` is accepted (unused) so call sites written
 * for the old wiki-resolver version don't need to change.
 */
export function useBossIconUrl(boss: string, _pixelWidth?: number): string | undefined {
  return bossIconFile(boss);
}
