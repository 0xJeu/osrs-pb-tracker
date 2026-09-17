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
 *
 * These are served from our own origin (public/banners/), NOT hotlinked from
 * the wiki. Hotlinking meant every cold-cache visitor pulled the full-resolution
 * source off wiki infrastructure to paint a header background - 14.7 MB across
 * this map, with the Theatre of Blood artwork alone at 5.7 MB. The OSRS Wiki
 * team has asked tools to stop doing exactly this; the cost scaled with our
 * traffic while landing on their donation-funded servers.
 *
 * Localised and downscaled to a 1000px bound (6.8 MB total, and zero wiki
 * bandwidth per visitor). Artwork is (c) Jagex Ltd, used to identify the
 * encounter it depicts.
 *
 * Adding a boss: download the image, downscale it, commit it under
 * public/banners/, and reference it by path. Never add a wiki URL here.
 */
const BOSS_BANNERS: Record<string, string> = {
  theatre_of_blood: '/banners/theatre-of-blood-artwork.jpg',
  chambers_of_xeric: '/banners/chambers-of-xeric-artwork.jpg',
  tombs_of_amascut: '/banners/tombs-of-amascut-1.jpg',
  inferno: '/banners/tzkal-zuk-artwork.jpg',
  fortis_colosseum: '/banners/fortis-colosseum-colossi-concept-art.jpg',

  abyssal_sire: '/banners/abyssal-sire-phase-1.png',
  alchemical_hydra: '/banners/alchemical-hydra-serpentine.png',
  amoxliatl: '/banners/amoxliatl.png',
  araxxor: '/banners/araxxor.png',
  artio: '/banners/artio.png',
  barbarian_assault: '/banners/barbarian-assault-gameplay.jpg',
  brutus: '/banners/demonic-brutus.png',
  bryophyta: '/banners/bryophyta.png',
  callisto: '/banners/callisto.png',
  calvarion: '/banners/calvar-ion.png',
  cerberus: '/banners/cerberus.png',
  chaos_elemental: '/banners/chaos-elemental.png',
  chaos_fanatic: '/banners/chaos-fanatic.png',
  commander_zilyana: '/banners/commander-zilyana.png',
  corporeal_beast: '/banners/corporeal-beast.png',
  corrupted_gauntlet: '/banners/the-corrupted-gauntlet.png',
  crazy_archaeologist: '/banners/crazy-archaeologist.png',
  dagannoth_prime: '/banners/dagannoth-prime.png',
  dagannoth_rex: '/banners/dagannoth-rex.png',
  dagannoth_supreme: '/banners/dagannoth-supreme.png',
  deranged_archaeologist: '/banners/deranged-archaeologist.png',
  doom_of_mokhaiotl: '/banners/doom-of-mokhaiotl.png',
  duke_sucellus: '/banners/duke-sucellus.png',
  fragment_of_seren: '/banners/fragment-of-seren.png',
  galvek: '/banners/galvek.png',
  gauntlet: '/banners/the-gauntlet.png',
  general_graardor: '/banners/general-graardor.png',
  giant_mole: '/banners/giant-mole.png',
  grotesque_guardians: '/banners/dawn.png',
  guardians_of_the_rift: '/banners/guardians-of-the-rift.jpg',
  hallowed_sepulchre: '/banners/hallowed-sepulchre-lobby.png',
  hespori: '/banners/hespori.png',
  hueycoatl: '/banners/the-hueycoatl.png',
  kalphite_queen: '/banners/kalphite-queen.png',
  king_black_dragon: '/banners/king-black-dragon.png',
  kraken: '/banners/kraken.png',
  kreearra: '/banners/kree-arra.png',
  kril_tsutsaroth: '/banners/k-ril-tsutsaroth.png',
  leviathan: '/banners/the-leviathan.png',
  maggot_king: '/banners/maggot-king.png',
  mimic: '/banners/the-mimic.png',
  nex: '/banners/nex.png',
  nightmare: '/banners/the-nightmare.png',
  obor: '/banners/obor.png',
  phantom_muspah: '/banners/phantom-muspah-ranged.png',
  phosanis_nightmare: '/banners/the-nightmare.png',
  royal_titans: '/banners/eldric-the-ice-king.png',
  sarachnis: '/banners/sarachnis.png',
  scorpia: '/banners/scorpia.png',
  scurrius: '/banners/scurrius.png',
  shellbane_gryphon: '/banners/shellbane-gryphon.png',
  skotizo: '/banners/skotizo.png',
  spindel: '/banners/spindel.png',
  tempoross: '/banners/tempoross.png',
  thermonuclear_smoke_devil: '/banners/thermonuclear-smoke-devil.png',
  tzhaar_fight_cave: '/banners/tzhaar-fight-cave.jpg',
  tztok_jad: '/banners/tztok-jad.png',
  vardorvis: '/banners/vardorvis.png',
  venenatis: '/banners/venenatis.png',
  vetion: '/banners/vet-ion.png',
  vorkath: '/banners/vorkath.png',
  whisperer: '/banners/the-whisperer.png',
  wintertodt: '/banners/howling-snow-storm.gif',
  yama: '/banners/yama.png',
  zalcano: '/banners/zalcano-weakened.png',
  zulrah: '/banners/zulrah-serpentine.png',
};

// The 5 hand-picked entries above are wide promotional artwork, shaped to
// fill the banner via `cover` with no cropping. Everything else is a wiki
// infobox render (tall portrait or square icon) that `cover` would blow up
// and crop into an unrecognizable sliver - those use `contain` instead (see
// theme-osrs-preview.css's .pbt-boss-banner rules).
const WIDE_ARTWORK_SLUGS = new Set([
  'theatre_of_blood',
  'chambers_of_xeric',
  'tombs_of_amascut',
  'inferno',
  'fortis_colosseum',
]);

export function bossBannerUrl(boss: string): string | undefined {
  const slug = resolveBossSlug(boss);
  return slug ? BOSS_BANNERS[slug] : undefined;
}

export function bossBannerFit(boss: string): 'cover' | 'contain' {
  const slug = resolveBossSlug(boss);
  return slug && WIDE_ARTWORK_SLUGS.has(slug) ? 'cover' : 'contain';
}
