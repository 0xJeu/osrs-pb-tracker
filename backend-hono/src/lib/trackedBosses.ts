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

/**
 * RuneLite exposes a bare "mode" personalbest key for these raid modes
 * (e.g. "theatre of blood hard mode") with no team-size suffix, representing
 * an ambiguous "best across any team size" value. The plugin's own
 * looksLikeRaidVariant() is meant to filter these client-side so the
 * Adventure Log parser's properly-labelled version (e.g. "theatre of blood -
 * hard - fastest room (5 player hard mode)") is used instead, but its regexes
 * only catch the suffixed forms ("... hard mode solo"), not the bare ones -
 * so an unpatched/older plugin install can still send them. Reject them here
 * too so they don't land as a duplicate row with a falsely "fresh" Recorded
 * timestamp.
 */
const REDUNDANT_BARE_MODE_KEYS = new Set([
  'theatre of blood hard mode',
  'theatre of blood entry mode',
  'chambers of xeric challenge mode',
  'tombs of amascut expert mode',
  'tombs of amascut entry mode',
]);

export function isRedundantBareModeKey(boss: string): boolean {
  return REDUNDANT_BARE_MODE_KEYS.has(normalize(boss));
}
