import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import type { LeaderboardPage, LeaderboardRow } from '../lib/api';
import { isLoaded, type LoadState } from '../lib/loadState';
import { bossTitleParts } from '../lib/format';
import type { Route } from './useRoute';

const LEADERBOARD_PAGE_SIZE = 50;
const preferredBosses = [
  'chambers of xeric - challenge mode - fastest overall (3 players)',
  'chambers of xeric',
  'zulrah',
];

export function pickInitialBoss(bosses: string[]) {
  return preferredBosses.find((boss) => bosses.includes(boss)) ?? bosses[0] ?? '';
}

export interface BossLeaderboardState {
  selectedBoss: string;
  leaderboard: LoadState<LeaderboardPage>;
  isPageLoading: boolean;
  rows: LeaderboardRow[];
  leaderboardOffset: number;
  setLeaderboardOffset: (offset: number) => void;
  titleParts: { primary: string; secondary: string };
  highlight?: string;
}

// `selectedBoss` can change (via the route-driven effect below) on a render
// before the leaderboard-fetch effect for that new boss has had a chance to
// run - `useEffect` callbacks fire after the browser paints, so without this
// guard a render in between could briefly show a previous boss's cached
// `leaderboard`/rows underneath the new boss's already-updated titleParts.
// Comparing which boss the current `leaderboard` value was actually fetched
// for (tracked separately, updated by the same effect that starts the
// fetch) closes that gap: a mismatch is treated as still loading, exactly
// like a fresh fetch that hasn't resolved yet.
export function selectDisplayLeaderboard(
  selectedBoss: string,
  leaderboardBoss: string | null,
  leaderboard: LoadState<LeaderboardPage>
): LoadState<LeaderboardPage> {
  return leaderboardBoss === selectedBoss ? leaderboard : { s: 'loading' };
}

export function useBossLeaderboard(route: Route, bosses: LoadState<string[]>): BossLeaderboardState {
  const [selectedBoss, setSelectedBoss] = useState('');
  // `null` means this route has not selected its initial page yet. A player
  // link supplies `highlight`, which the backend uses to find that initial
  // page. Once the user paginates, the explicit offset must take precedence
  // or every request would be re-centered on the highlighted player.
  const [requestedOffset, setRequestedOffset] = useState<number | null>(null);
  const [leaderboard, setLeaderboard] = useState<LoadState<LeaderboardPage>>({ s: 'idle' });
  const [leaderboardBoss, setLeaderboardBoss] = useState<string | null>(null);
  const [isPageLoading, setIsPageLoading] = useState(false);

  // The boss page's selected boss is driven by the URL (route.boss), not the
  // other way around - landing directly on /boss/<key>, following a link, or
  // switching via the picker all just change route.boss and this follows.
  useEffect(() => {
    if (route.name === 'boss' && route.boss) setSelectedBoss(route.boss);
  }, [route]);

  // Once the boss list loads, fill in a default only if nothing else (the
  // effect above, e.g. from a direct /boss/<key> URL) has already set one.
  useEffect(() => {
    if (isLoaded(bosses)) setSelectedBoss((current) => current || pickInitialBoss(bosses.data));
  }, [bosses]);

  const highlight = route.name === 'boss' ? route.highlight : undefined;

  useEffect(() => {
    setRequestedOffset(null);
  }, [route.name, route.name === 'boss' ? route.boss : undefined, highlight]);

  useEffect(() => {
    if (route.name !== 'boss' || !selectedBoss) return;
    let alive = true;
    // Keep the current rows mounted during same-boss pagination. Removing all
    // 50 rows while a request is in flight collapses the document and makes
    // the browser jump before the next page arrives. A boss change still gets
    // the full loading state so stale rows never appear under a new heading.
    if (leaderboardBoss !== selectedBoss) setLeaderboard({ s: 'loading' });
    setIsPageLoading(true);
    setLeaderboardBoss(selectedBoss);
    api.getLeaderboardPage(
      selectedBoss,
      LEADERBOARD_PAGE_SIZE,
      requestedOffset ?? 0,
      requestedOffset === null ? highlight : undefined
    )
      .then((data) => {
        if (!alive) return;
        setLeaderboard({ s: 'loaded', data });
        setIsPageLoading(false);
      })
      .catch(() => {
        if (!alive) return;
        setLeaderboard({ s: 'error' });
        setIsPageLoading(false);
      });
    return () => { alive = false; };
  }, [route.name, selectedBoss, highlight, requestedOffset]);

  const displayLeaderboard = selectDisplayLeaderboard(selectedBoss, leaderboardBoss, leaderboard);
  const rows = useMemo(() => (isLoaded(displayLeaderboard) ? displayLeaderboard.data.rows : []), [displayLeaderboard]);
  const titleParts = bossTitleParts(selectedBoss);

  return {
    selectedBoss,
    leaderboard: displayLeaderboard,
    isPageLoading,
    rows,
    leaderboardOffset: requestedOffset ?? 0,
    setLeaderboardOffset: setRequestedOffset,
    titleParts,
    highlight,
  };
}
