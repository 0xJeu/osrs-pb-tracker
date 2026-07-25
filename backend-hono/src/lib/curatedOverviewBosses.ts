// Server-owned homepage "Top Bosses" card list. Deliberately hardcoded (not
// caller-supplied) so /api/leaderboard-overview always has one stable cache
// key and can't be used to force an unbounded query. Currently diverges from
// the frontend's own TOP_BOSS_BASES curated list
// (frontend/src/components/PhaseTwoOsrsPreview.tsx) - the frontend's list is
// expected to be retired in favor of this endpoint once the frontend
// view-scoped-fetching plan lands, at which point this becomes the single
// source of truth and the two lists should be reconciled deliberately.
export const CURATED_OVERVIEW_BOSSES = [
  'zulrah',
  'vorkath',
  'the whisperer',
  'duke sucellus',
  'the leviathan',
] as const;
