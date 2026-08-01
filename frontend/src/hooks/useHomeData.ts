import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { LeaderboardRow, QuickStats, RecentSync } from '../lib/api';
import type { LoadState } from '../lib/loadState';
import type { Route } from './useRoute';

export interface HomeData {
  stats: LoadState<QuickStats>;
  recentSyncs: LoadState<RecentSync[]>;
  topBosses: LoadState<Array<{ boss: string; leader: LeaderboardRow | null }>>;
}

export function useHomeData(route: Route): HomeData {
  const [stats, setStats] = useState<LoadState<QuickStats>>({ s: 'idle' });
  const [recentSyncs, setRecentSyncs] = useState<LoadState<RecentSync[]>>({ s: 'idle' });
  const [topBosses, setTopBosses] = useState<LoadState<Array<{ boss: string; leader: LeaderboardRow | null }>>>({ s: 'idle' });

  // None of the three effects below depend on their own `*.s` field: each
  // effect's own setState({s:'loading'}) call changes that value, and
  // including it as a dependency would make React re-run the effect (tearing
  // down the in-flight request's `alive` flag) before the real fetch had a
  // chance to settle - the loading state would never resolve to loaded or
  // error. Reading `*.s` from the closure at run time still gets the idle
  // guard right on mount and on every subsequent route change.
  // Each cleanup below resets its resource back to 'idle' only while it's
  // still 'loading' at teardown time (i.e. the route changed away before
  // the request settled). Otherwise the idle guard above would see a
  // permanently stranded 'loading' on return and never start a replacement
  // request. A completed 'loaded'/'error' result is left alone - it should
  // stay cached, not be thrown away just because the view was left.
  useEffect(() => {
    if (route.name !== 'home' || stats.s !== 'idle') return;
    let alive = true;
    setStats({ s: 'loading' });
    api.getStats().then((data) => alive && setStats({ s: 'loaded', data })).catch(() => alive && setStats({ s: 'error' }));
    return () => {
      alive = false;
      setStats((current) => (current.s === 'loading' ? { s: 'idle' } : current));
    };
  }, [route.name]);

  useEffect(() => {
    if (route.name !== 'home' || recentSyncs.s !== 'idle') return;
    let alive = true;
    setRecentSyncs({ s: 'loading' });
    api.getRecentSyncs(6).then((data) => alive && setRecentSyncs({ s: 'loaded', data })).catch(() => alive && setRecentSyncs({ s: 'error' }));
    return () => {
      alive = false;
      setRecentSyncs((current) => (current.s === 'loading' ? { s: 'idle' } : current));
    };
  }, [route.name]);

  // One request replaces the previous 5-request per-boss fan-out (Workstream D).
  // Also loaded for the Leaderboards page, which shows a real top-player
  // subtitle per card instead of a fabricated stat.
  useEffect(() => {
    if ((route.name !== 'home' && route.name !== 'leaderboards') || topBosses.s !== 'idle') return;
    let alive = true;
    setTopBosses({ s: 'loading' });
    api.getLeaderboardOverview()
      .then((data) => alive && setTopBosses({ s: 'loaded', data }))
      .catch(() => alive && setTopBosses({ s: 'error' }));
    return () => {
      alive = false;
      setTopBosses((current) => (current.s === 'loading' ? { s: 'idle' } : current));
    };
  }, [route.name]);

  return { stats, recentSyncs, topBosses };
}
