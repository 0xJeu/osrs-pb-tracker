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

  useEffect(() => {
    if (route.name !== 'home' || stats.s !== 'idle') return;
    let alive = true;
    setStats({ s: 'loading' });
    api.getStats().then((data) => alive && setStats({ s: 'loaded', data })).catch(() => alive && setStats({ s: 'error' }));
    return () => { alive = false; };
  }, [route.name, stats.s]);

  useEffect(() => {
    if (route.name !== 'home' || recentSyncs.s !== 'idle') return;
    let alive = true;
    setRecentSyncs({ s: 'loading' });
    api.getRecentSyncs(6).then((data) => alive && setRecentSyncs({ s: 'loaded', data })).catch(() => alive && setRecentSyncs({ s: 'error' }));
    return () => { alive = false; };
  }, [route.name, recentSyncs.s]);

  // One request replaces the previous 5-request per-boss fan-out (Workstream D).
  useEffect(() => {
    if (route.name !== 'home' || topBosses.s !== 'idle') return;
    let alive = true;
    setTopBosses({ s: 'loading' });
    api.getLeaderboardOverview()
      .then((data) => alive && setTopBosses({ s: 'loaded', data }))
      .catch(() => alive && setTopBosses({ s: 'error' }));
    return () => { alive = false; };
  }, [route.name, topBosses.s]);

  return { stats, recentSyncs, topBosses };
}
