/**
 * Bosses/activities Jagex actually tracks an official personal best time
 * for, per the OSRS Wiki's Combat Achievements/Bosses page
 * (https://oldschool.runescape.wiki/w/Combat_Achievements/Bosses).
 *
 * Mirrors backend-hono/src/lib/trackedBosses.ts (kept in sync manually,
 * since the two apps don't share a package) - the backend already rejects
 * these at sync time, but any already-synced rows for untracked bosses
 * (e.g. an existing Dagannoth Prime record) still exist in the database
 * until a cleanup script removes them, so this filters them out of display
 * as well.
 */
const TRACKED_BOSS_PREFIXES = [
  'alchemical hydra',
  'amoxliatl',
  'araxxor',
  'chambers of xeric',
  'corrupted gauntlet',
  'gauntlet',
  'duke sucellus',
  'fortis colosseum',
  'sol heredit',
  'grotesque guardians',
  'hespori',
  'hueycoatl',
  'leviathan',
  'maggot king',
  'mimic',
  'nex',
  "phosani's nightmare",
  'nightmare',
  'phantom muspah',
  'royal titans',
  'shellbane gryphon',
  'tempoross',
  'theatre of blood',
  'tzhaar-ket-rak',
  'tzhaar fight cave',
  'fight caves',
  'tztok-jad',
  'tzkal-zuk',
  'inferno',
  'vardorvis',
  'vorkath',
  'whisperer',
  'yama',
  'zulrah',
  'tombs of amascut',
];

function normalize(boss: string): string {
  const lower = boss.trim().toLowerCase();
  return lower.startsWith('the ') ? lower.slice(4) : lower;
}

export function isTrackedBoss(boss: string): boolean {
  const normalized = normalize(boss);
  return TRACKED_BOSS_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}
