/**
 * Curated accent color per boss, themed loosely off each boss/raid's
 * in-game palette (Inferno's fire, Vorkath's ice, ToA's desert sand, ...).
 * Drives --pbt-accent, which the whole OSRS preview theme's borders/fills/
 * hairlines derive from via color-mix() - see theme-osrs-preview.css.
 * Bosses with no entry fall back to the default OSRS interface orange.
 */
const DEFAULT_ACCENT = '#ff981f';

const BOSS_ACCENTS: Record<string, string> = {
  'theatre of blood': '#a23b52',
  'chambers of xeric': '#5c8a3a',
  'tombs of amascut': '#c98a3e',
  inferno: '#e8491d',
  'fortis colosseum': '#b5651d',
  'sol heredit': '#b5651d',
  gauntlet: '#3fae7a',
  'corrupted gauntlet': '#c0392b',
  vorkath: '#3fa9c9',
  zulrah: '#4caf50',
  nex: '#6a4fa0',
  nightmare: '#6a4c93',
  "phosani's nightmare": '#6a4c93',
  araxxor: '#8b2e2e',
  amoxliatl: '#3fa9c9',
  'phantom muspah': '#69727d',
  'duke sucellus': '#6fa8bb',
  leviathan: '#1f6f6f',
  whisperer: '#4a3f7a',
  vardorvis: '#7a1f1f',
  yama: '#c0392b',
  'alchemical hydra': '#4a7c59',
  'king black dragon': '#3fae5a',
  'corporeal beast': '#8e7cc3',
  'general graardor': '#7a1f1f',
  "kree'arra": '#3fa9c9',
  'commander zilyana': '#4caf50',
  "k'ril tsutsaroth": '#7a1f1f',
  callisto: '#5c4a3a',
  artio: '#5c4a3a',
  venenatis: '#4a7c3f',
  spindel: '#4a7c3f',
  "vet'ion": '#6a4fa0',
  "calvar'ion": '#6a4fa0',
};

function normalize(boss: string): string {
  const lower = boss.trim().toLowerCase();
  return lower.startsWith('the ') ? lower.slice(4) : lower;
}

export function bossAccentColor(boss: string): string {
  const normalized = normalize(boss);
  const match = Object.keys(BOSS_ACCENTS).find((prefix) => normalized.startsWith(prefix));
  return match ? BOSS_ACCENTS[match] : DEFAULT_ACCENT;
}
