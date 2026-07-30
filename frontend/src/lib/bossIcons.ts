import { createWikiImageResolver, useWikiImageUrl } from './wikiImageResolver';

/**
 * Boss -> wiki image, verified to exist against the OSRS Wiki's MediaWiki
 * API (query&titles=..., checking for a 'missing' page rather than guessing
 * at a URL). Prefers each boss's dedicated "icon.png" - the small square
 * portrait the wiki uses for the same hiscores-style boss icon RuneLite's
 * own Hiscore plugin shows (matching what the plugin's side panel displays)
 * - and falls back to the monster's main infobox render only where no
 * "icon.png" exists on the wiki for it. Raids (no single "monster" of their
 * own) use their final boss as a stand-in - Great Olm for Chambers of Xeric,
 * Verzik Vitur for Theatre of Blood, Tumeken's Warden for Tombs of Amascut -
 * and awakened DT2 variants intentionally share their base form's entry
 * (matched via prefix below), same as the RuneLite plugin's side panel. A
 * few very recently added bosses (Royal Titans, Shellbane Gryphon,
 * Hueycoatl) don't have a suitable cropped image yet - callers fall back to
 * a text monogram for anything with no entry here.
 */
const BOSS_ICON_FILES: Record<string, string> = {
  // Raids (final boss's own icon.png as stand-in)
  'chambers of xeric': 'Great Olm icon.png',
  'theatre of blood': 'Verzik Vitur icon.png',
  'tombs of amascut': "Tumeken's Warden icon.png",

  // TzHaar (no icon.png for Jad itself - its own portrait stands in)
  'tzhaar-ket-rak': 'TzTok-Jad.png',
  'tztok-jad': 'TzTok-Jad.png',
  'tzhaar fight cave': 'TzTok-Jad.png',
  'tzkal-zuk': 'TzKal-Zuk icon.png',
  inferno: 'TzKal-Zuk icon.png',

  // DT2 (no icon.png exists for any of these yet - awakened variants match
  // via prefix, e.g. "duke sucellus (awakened)" starts with "duke
  // sucellus", so they already share these entries without a separate one).
  'duke sucellus': 'Duke Sucellus.png',
  leviathan: 'Leviathan.png',
  whisperer: 'The Whisperer.png',
  vardorvis: 'Vardorvis.png',

  // The Nightmare (Phosani's has no distinct wiki image of its own)
  nightmare: 'The Nightmare icon.png',
  "phosani's nightmare": 'The Nightmare icon.png',

  // Minigames / solo challenges (no icon.png for these specific ones)
  gauntlet: 'The Gauntlet.png',
  'corrupted gauntlet': 'The Corrupted Gauntlet.png',
  'fortis colosseum': 'Fortis Colosseum.png',
  'sol heredit': 'Fortis Colosseum.png',
  tempoross: 'Tempoross icon.png',
  wintertodt: 'Wintertodt icon.png',
  'guardians of the rift': 'Guardians of the Rift.png',
  'hallowed sepulchre': 'Hallowed Sepulchre icon.png',

  // Wilderness bosses (no icon.png for any of these)
  callisto: 'Callisto.png',
  artio: 'Artio.png',
  venenatis: 'Venenatis.png',
  spindel: 'Spindel.png',
  "vet'ion": "Vet'ion.png",
  "calvar'ion": "Calvar'ion.png",
  'chaos elemental': 'Chaos Elemental.png',
  'chaos fanatic': 'Chaos Fanatic.png',
  'crazy archaeologist': 'Crazy archaeologist.png',
  'deranged archaeologist': 'Deranged archaeologist.png',

  // God Wars Dungeon
  'general graardor': 'General Graardor icon.png',
  "kree'arra": "Kree'arra icon.png",
  'commander zilyana': 'Commander Zilyana icon.png',
  "k'ril tsutsaroth": "K'ril Tsutsaroth icon.png",

  // Slayer bosses
  kraken: 'Kraken icon.png',
  cerberus: 'Cerberus icon.png',
  'thermonuclear smoke devil': 'Thermonuclear smoke devil icon.png',
  'alchemical hydra': 'Alchemical Hydra icon.png',
  'abyssal sire': 'Abyssal Sire icon.png',
  araxxor: 'Araxxor.png',
  'grotesque guardians': 'Grotesque Guardians icon.png',
  skotizo: 'Skotizo icon.png',
  'kalphite queen': 'Kalphite Queen icon.png',

  // Standalone bosses
  nex: 'Nex icon.png',
  zulrah: 'Zulrah icon.png',
  vorkath: 'Vorkath icon.png',
  sarachnis: 'Sarachnis icon.png',
  'king black dragon': 'King Black Dragon icon.png',
  'giant mole': 'Giant Mole icon.png',
  zalcano: 'Zalcano icon.png',
  obor: 'Obor icon.png',
  bryophyta: 'Bryophyta icon.png',
  'dagannoth rex': 'Dagannoth Rex.png',
  'dagannoth prime': 'Dagannoth Prime.png',
  'dagannoth supreme': 'Dagannoth Supreme.png',
  'corporeal beast': 'Corporeal Beast icon.png',
  scorpia: 'Scorpia.png',
  amoxliatl: 'Amoxliatl chathead.png',
  brutus: 'Brutus.png',
  'demonic brutus': 'Brutus.png',
  'fragment of seren': 'Fragment of Seren.png',
  galvek: 'Galvek.png',
  hespori: 'Hespori icon.png',
  'maggot king': 'Maggot King.png',
  mimic: 'Mimic.png',
  'phantom muspah': 'Phantom Muspah (melee).png',
  scurrius: 'Scurrius.png',
  yama: 'Yama.png',
  hueycoatl: 'The Hueycoatl.png',
  'shellbane gryphon': 'Shellbane gryphon.png',
  // Two separate titans (Branda/Effigy), no single "icon.png" of its own -
  // its logo stands in, same idea as raids using their final boss.
  'royal titans': 'Royal Titans logo.png',
};

function normalize(boss: string): string {
  const lower = boss.trim().toLowerCase();
  return lower.startsWith('the ') ? lower.slice(4) : lower;
}

/** Boss -> wiki filename (no URL resolution yet). Undefined = no mapped icon, caller shows a monogram. */
export function bossIconFile(boss: string): string | undefined {
  const normalized = normalize(boss);
  const match = Object.keys(BOSS_ICON_FILES).find((prefix) => normalized.startsWith(prefix));
  return match ? BOSS_ICON_FILES[match] : undefined;
}

const resolver = createWikiImageResolver();

/** React hook: resolves a boss's portrait icon to a real, cacheable thumb URL. */
export function useBossIconUrl(boss: string, pixelWidth = 96): string | undefined {
  return useWikiImageUrl(resolver, bossIconFile(boss), pixelWidth);
}
