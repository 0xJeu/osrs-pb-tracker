// Server-owned homepage "Top Bosses" card list. Deliberately hardcoded (not
// caller-supplied) so /api/leaderboard-overview always has one stable cache
// key and can't be used to force an unbounded query. Mirrors the frontend's
// TOP_BOSS_BASES curated list (frontend/src/components/PhaseTwoOsrsPreview.tsx) -
// keep them in sync manually since the frontend resolves multi-variant raids
// (Theatre of Blood, Chambers of Xeric, Tombs of Amascut) to their default
// mode's first variant, while this list uses exact synced boss keys.
export const CURATED_OVERVIEW_BOSSES = [
  'zulrah',
  'vorkath',
  'the whisperer',
  'duke sucellus',
  'the leviathan',
] as const;
