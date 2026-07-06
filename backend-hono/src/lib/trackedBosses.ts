/**
 * Bosses/activities Jagex actually tracks an official personal best time for,
 * per the OSRS Wiki's Combat Achievements/Bosses page
 * (https://oldschool.runescape.wiki/w/Combat_Achievements/Bosses), which
 * documents the same server-tracked data that also powers the in-game
 * Combat Achievements UI.
 *
 * Many other bosses (GWD, Dagannoth Kings, Cerberus, Kraken, King Black
 * Dragon, etc.) have no official Jagex personal best at all - any
 * "personalbest" RSProfile key RuneLite reports for them is a client-side
 * artifact, not something Jagex validates, and can also be spoofed via chat
 * command abuse. This list is the sync route's allowlist so those never
 * land in the database.
 *
 * Matching is prefix-based (after normalizing away a leading "the " and
 * lowercasing) rather than exact-string, because the plugin sends both raw
 * RSProfile keys ("zulrah") and Adventure Log-derived variant labels
 * ("Theatre of Blood - Fastest Room (3 player)").
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
