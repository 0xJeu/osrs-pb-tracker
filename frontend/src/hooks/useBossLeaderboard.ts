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
  rows: LeaderboardRow[];
  leaderboardOffset: number;
  setLeaderboardOffset: (offset: number) => void;
  titleParts: { primary: string; secondary: string };
  highlight?: string;
}

export function useBossLeaderboard(route: Route, bosses: LoadState<string[]>): BossLeaderboardState {
  const [selectedBoss, setSelectedBoss] = useState('');
  const [leaderboardOffset, setLeaderboardOffset] = useState(0);
  const [leaderboard, setLeaderboard] = useState<LoadState<LeaderboardPage>>({ s: 'idle' });

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

  useEffect(() => {
    setLeaderboardOffset(0);
  }, [selectedBoss]);

  const highlight = route.name === 'boss' ? route.highlight : undefined;

  useEffect(() => {
    if (route.name !== 'boss' || !selectedBoss) return;
    let alive = true;
    setLeaderboard({ s: 'loading' });
    api.getLeaderboardPage(selectedBoss, LEADERBOARD_PAGE_SIZE, leaderboardOffset, highlight)
      .then((data) => alive && setLeaderboard({ s: 'loaded', data }))
      .catch(() => alive && setLeaderboard({ s: 'error' }));
    return () => { alive = false; };
  }, [route.name, selectedBoss, highlight, leaderboardOffset]);

  const rows = useMemo(() => (isLoaded(leaderboard) ? leaderboard.data.rows : []), [leaderboard]);
  const titleParts = bossTitleParts(selectedBoss);

  return { selectedBoss, leaderboard, rows, leaderboardOffset, setLeaderboardOffset, titleParts, highlight };
}
