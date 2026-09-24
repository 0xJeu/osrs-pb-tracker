import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { LoadState } from '../lib/loadState';
import type { Route } from './useRoute';

function sameBosses(a: string[], b: string[]) {
  return a.length === b.length && a.every((boss, index) => boss === b[index]);
}

// Needed on home (for search-alias resolution), boss (for the picker), and
// leaderboards (the full boss listing) views. Other views may still get boss
// suggestions from universal search without preloading the full list.
export function useBossList(route: Route): LoadState<string[]> {
  const [bosses, setBosses] = useState<LoadState<string[]>>({ s: 'idle' });
  const shouldLoadBosses = route.name === 'home' || route.name === 'boss' || route.name === 'leaderboards';

  useEffect(() => {
    // Runs on entering a view that needs the list and whenever the tab
    // becomes visible again. api.getBosses() answers from its bounded session
    // cache until that expires, so these refreshes only reach the network
    // occasionally. A loaded list stays on screen while a refresh is in
    // flight and is kept if the refresh fails. Depending on eligibility
    // rather than route.name preserves an in-flight request across
    // Home <-> Boss navigation.
    if (!shouldLoadBosses) return;
    let alive = true;

    const load = () => {
      setBosses((current) => (current.s === 'loaded' ? current : { s: 'loading' }));
      api.getBosses().then((data) => {
        if (!alive) return;
        setBosses((current) => (
          current.s === 'loaded' && sameBosses(current.data, data) ? current : { s: 'loaded', data }
        ));
      }).catch(() => {
        if (alive) setBosses((current) => (current.s === 'loaded' ? current : { s: 'error' }));
      });
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') load();
    };

    load();
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      alive = false;
      document.removeEventListener('visibilitychange', onVisibilityChange);
      // A response for a view we've left is discarded above; reset a stranded
      // 'loading' so returning starts a replacement request. A settled
      // 'loaded'/'error' result stays until the next refresh replaces it.
      setBosses((current) => (current.s === 'loading' ? { s: 'idle' } : current));
    };
  }, [shouldLoadBosses]);

  return bosses;
}
