import { resolveBossSlug } from './bossIcons';

/**
 * Boss/raid slug (same resolution as bossIcons.ts - an awakened DT2 boss or
 * a specific TzHaar-Ket-Rak's Challenge variant already collapses to its
 * base slug before this map is consulted) -> full-size OSRS Wiki artwork
 * URL, used as the big header background on a boss's own leaderboard page.
 *
 * The five raid/challenge entries were hand-picked promotional artwork
 * (nicer for a banner than the small in-game logo). Everything else was
 * bulk-resolved via the wiki's `prop=pageimages` API, which returns each
 * page's real infobox image - verified against the actual API response
 * (see conversation), not guessed filenames.
 */
const BOSS_BANNERS: Record<string, string> = {
  theatre_of_blood: 'https://oldschool.runescape.wiki/images/Theatre_of_Blood_artwork.jpg',
  chambers_of_xeric: 'https://oldschool.runescape.wiki/images/Chambers_of_Xeric_artwork.jpg',
  tombs_of_amascut: 'https://oldschool.runescape.wiki/images/Tombs_of_Amascut_%281%29.jpg',
  inferno: 'https://oldschool.runescape.wiki/images/TzKal-Zuk_artwork.jpg',
  fortis_colosseum: 'https://oldschool.runescape.wiki/images/Fortis_Colosseum_-_colossi_concept_art.jpg',

  abyssal_sire: 'https://oldschool.runescape.wiki/images/Abyssal_Sire_%28phase_1%29.png',
  alchemical_hydra: 'https://oldschool.runescape.wiki/images/Alchemical_Hydra_%28serpentine%29.png',
  amoxliatl: 'https://oldschool.runescape.wiki/images/Amoxliatl.png',
  araxxor: 'https://oldschool.runescape.wiki/images/Araxxor.png',
  artio: 'https://oldschool.runescape.wiki/images/Artio.png',
  barbarian_assault: 'https://oldschool.runescape.wiki/images/Barbarian_Assault_gameplay.png',
  brutus: 'https://oldschool.runescape.wiki/images/Demonic_Brutus.png',
  bryophyta: 'https://oldschool.runescape.wiki/images/Bryophyta.png',
  callisto: 'https://oldschool.runescape.wiki/images/Callisto.png',
  calvarion: 'https://oldschool.runescape.wiki/images/Calvar%27ion.png',
  cerberus: 'https://oldschool.runescape.wiki/images/Cerberus.png',
  chaos_elemental: 'https://oldschool.runescape.wiki/images/Chaos_Elemental.png',
  chaos_fanatic: 'https://oldschool.runescape.wiki/images/Chaos_Fanatic.png',
  commander_zilyana: 'https://oldschool.runescape.wiki/images/Commander_Zilyana.png',
  corporeal_beast: 'https://oldschool.runescape.wiki/images/Corporeal_Beast.png',
  corrupted_gauntlet: 'https://oldschool.runescape.wiki/images/The_Corrupted_Gauntlet.png',
  crazy_archaeologist: 'https://oldschool.runescape.wiki/images/Crazy_archaeologist.png',
  dagannoth_prime: 'https://oldschool.runescape.wiki/images/Dagannoth_Prime.png',
  dagannoth_rex: 'https://oldschool.runescape.wiki/images/Dagannoth_Rex.png',
  dagannoth_supreme: 'https://oldschool.runescape.wiki/images/Dagannoth_Supreme.png',
  deranged_archaeologist: 'https://oldschool.runescape.wiki/images/Deranged_archaeologist.png',
  duke_sucellus: 'https://oldschool.runescape.wiki/images/Duke_Sucellus.png',
  fragment_of_seren: 'https://oldschool.runescape.wiki/images/Fragment_of_Seren.png',
  galvek: 'https://oldschool.runescape.wiki/images/Galvek.png',
  gauntlet: 'https://oldschool.runescape.wiki/images/The_Gauntlet.png',
  general_graardor: 'https://oldschool.runescape.wiki/images/General_Graardor.png',
  giant_mole: 'https://oldschool.runescape.wiki/images/Giant_Mole.png',
  grotesque_guardians: 'https://oldschool.runescape.wiki/images/Dawn.png',
  guardians_of_the_rift: 'https://oldschool.runescape.wiki/images/Guardians_of_the_Rift.png',
  hallowed_sepulchre: 'https://oldschool.runescape.wiki/images/Hallowed_Sepulchre_lobby.png',
  hespori: 'https://oldschool.runescape.wiki/images/Hespori.png',
  hueycoatl: 'https://oldschool.runescape.wiki/images/The_Hueycoatl.png',
  kalphite_queen: 'https://oldschool.runescape.wiki/images/Kalphite_Queen.png',
  king_black_dragon: 'https://oldschool.runescape.wiki/images/King_Black_Dragon.png',
  kraken: 'https://oldschool.runescape.wiki/images/Kraken.png',
  kreearra: 'https://oldschool.runescape.wiki/images/Kree%27arra.png',
  kril_tsutsaroth: 'https://oldschool.runescape.wiki/images/K%27ril_Tsutsaroth.png',
  leviathan: 'https://oldschool.runescape.wiki/images/The_Leviathan.png',
  maggot_king: 'https://oldschool.runescape.wiki/images/Maggot_King.png',
  mimic: 'https://oldschool.runescape.wiki/images/The_Mimic.png',
  nex: 'https://oldschool.runescape.wiki/images/Nex.png',
  nightmare: 'https://oldschool.runescape.wiki/images/The_Nightmare.png',
  obor: 'https://oldschool.runescape.wiki/images/Obor.png',
  phantom_muspah: 'https://oldschool.runescape.wiki/images/Phantom_Muspah_%28ranged%29.png',
  phosanis_nightmare: 'https://oldschool.runescape.wiki/images/The_Nightmare.png',
  royal_titans: 'https://oldschool.runescape.wiki/images/Eldric_the_Ice_King.png',
  sarachnis: 'https://oldschool.runescape.wiki/images/Sarachnis.png',
  scorpia: 'https://oldschool.runescape.wiki/images/Scorpia.png',
  scurrius: 'https://oldschool.runescape.wiki/images/Scurrius.png',
  shellbane_gryphon: 'https://oldschool.runescape.wiki/images/Shellbane_gryphon.png',
  skotizo: 'https://oldschool.runescape.wiki/images/Skotizo.png',
  spindel: 'https://oldschool.runescape.wiki/images/Spindel.png',
  tempoross: 'https://oldschool.runescape.wiki/images/Tempoross.png',
  thermonuclear_smoke_devil: 'https://oldschool.runescape.wiki/images/Thermonuclear_smoke_devil.png',
  tzhaar_fight_cave: 'https://oldschool.runescape.wiki/images/TzHaar_Fight_Cave.png',
  tztok_jad: 'https://oldschool.runescape.wiki/images/TzTok-Jad.png',
  vardorvis: 'https://oldschool.runescape.wiki/images/Vardorvis.png',
  venenatis: 'https://oldschool.runescape.wiki/images/Venenatis.png',
  vetion: 'https://oldschool.runescape.wiki/images/Vet%27ion.png',
  vorkath: 'https://oldschool.runescape.wiki/images/Vorkath.png',
  whisperer: 'https://oldschool.runescape.wiki/images/The_Whisperer.png',
  wintertodt: 'https://oldschool.runescape.wiki/images/Howling_Snow_Storm.gif',
  yama: 'https://oldschool.runescape.wiki/images/Yama.png',
  zalcano: 'https://oldschool.runescape.wiki/images/Zalcano_%28weakened%29.png',
  zulrah: 'https://oldschool.runescape.wiki/images/Zulrah_%28serpentine%29.png',
};

export function bossBannerUrl(boss: string): string | undefined {
  const slug = resolveBossSlug(boss);
  return slug ? BOSS_BANNERS[slug] : undefined;
}
