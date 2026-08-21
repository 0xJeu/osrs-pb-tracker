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
  'doom of mokhaiotl',
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
 * Doom of Mokhaiotl's deepest delve record is a depth level read off the
 * boss's in-game scoreboard (see Scoreboard (Doom of Mokhaiotl) on the OSRS
 * Wiki), not a fight-duration PB - a bigger number is a better record, the
 * opposite of every time-based boss here. The `personal_bests.time_seconds`
 * column is reused to store it (no schema change) since it's just a numeric
 * value column; every "faster is better" comparison in sync.ts, leaderboard.ts,
 * and players.ts checks this set to flip direction for this one boss key.
 */
export const DEEPEST_DELVE_BOSS = 'doom of mokhaiotl deepest delve';

const HIGHER_IS_BETTER_BOSSES = new Set([DEEPEST_DELVE_BOSS]);

export function isHigherIsBetterBoss(boss: string): boolean {
  return HIGHER_IS_BETTER_BOSSES.has(normalize(boss));
}

/**
 * Extremely conservative activity-specific floors for values that cannot
 * represent a full completion. These are not competitive-record thresholds:
 * they only reject physically impossible outliers while leaving ample room
 * for future strategies and game updates. Add a floor only when the activity
 * structure makes it unambiguous.
 *
 * Inferno has 69 waves, so a full completion under one minute cannot be the
 * official run time. A historical 12-second value polluted the leaderboard
 * and could never be displaced because PB updates only accept faster times.
 *
 * Theatre of Blood has six fixed encounters (Maiden, Bloat, Nylocas, Sotetseg,
 * Xarpus, Verzik), each with mechanics that take multiple minutes even for a
 * flawless team - the fastest confirmed team times are in the 11-12 minute
 * range. Two historical values (45s and 73s) polluted this leaderboard's top
 * ranks and, same as Inferno, could never be displaced by a real time. 300s
 * (5 minutes) is well below any plausible legitimate run, not a competitive
 * threshold.
 */
const MIN_REASONABLE_SECONDS_BY_BOSS = new Map<string, number>([
  ['inferno', 60],
  ['theatre of blood', 300],
]);

// Deepest delve has no natural floor (a higher value is a better record), but
// an unbounded value could otherwise let a bogus reading corrupt the public
// leaderboard forever, since a "faster/higher" resync can never overwrite it
// downward. The global record was 260 as of August 2026; this cap leaves
// generous headroom for future progress while still rejecting obvious
// garbage (e.g. a misparsed widget value in the millions).
const MAX_REASONABLE_VALUE_BY_BOSS = new Map<string, number>([[DEEPEST_DELVE_BOSS, 2000]]);

export function isReasonablePersonalBestTime(boss: string, timeSeconds: number): boolean {
  if (!Number.isFinite(timeSeconds) || timeSeconds <= 0) {
    return false;
  }
  const normalized = normalize(boss);
  const minimum = MIN_REASONABLE_SECONDS_BY_BOSS.get(normalized);
  if (minimum !== undefined && timeSeconds < minimum) {
    return false;
  }
  const maximum = MAX_REASONABLE_VALUE_BY_BOSS.get(normalized);
  return maximum === undefined || timeSeconds <= maximum;
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

/**
 * Mirrors the plugin's looksLikeRaidVariant() "nightmare solo" / "nightmare
 * 2 players" / "nightmare 6+ players" pattern. Unlike the bare mode keys
 * above, this one's regex does require the team-size suffix, so it should
 * already be gated client-side - but real production data showed it landing
 * anyway (e.g. an older/unpatched plugin install), duplicating the Adventure
 * Log-labeled "the nightmare - fastest overall (6+ players)" row. Rejected
 * here too as defense in depth, regardless of plugin version.
 */
const NIGHTMARE_TEAM_SIZE_PATTERN = /^nightmare (solo|\d+ players|\d\+ players|\d+-\d+ players)$/;

export function isRedundantDuplicateKey(boss: string): boolean {
  const normalized = normalize(boss);
  return REDUNDANT_BARE_MODE_KEYS.has(normalized) || NIGHTMARE_TEAM_SIZE_PATTERN.test(normalized);
}
