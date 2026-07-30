import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { LoadState } from '../lib/loadState';
import type { Route } from './useRoute';

// Needed on home (for search-alias resolution), boss (for the picker), and
// leaderboards (the full boss listing) views. Other views may still get boss
// suggestions from universal search without preloading the full list.
export function useBossList(route: Route): LoadState<string[]> {
  const [bosses, setBosses] = useState<LoadState<string[]>>({ s: 'idle' });
  const shouldLoadBosses = route.name === 'home' || route.name === 'boss' || route.name === 'leaderboards';

  useEffect(() => {
    // Deliberately NOT depending on bosses.s: this effect's own
    // setBosses({s:'loading'}) call changes that value, and if it were a
    // dependency React would re-run this effect (tearing down the in-flight
    // request's `alive` flag) before the real fetch had a chance to settle -
    // the loading state would never resolve. Reading bosses.s from the
    // closure at run time still gets the guard right when entering a view
    // that needs the list. Depending on eligibility rather than route.name
    // also preserves an in-flight request across Home <-> Boss navigation.
    if (!shouldLoadBosses || bosses.s !== 'idle') return;
    let alive = true;
    setBosses({ s: 'loading' });
    api.getBosses().then((data) => {
      if (alive) setBosses({ s: 'loaded', data });
    }).catch(() => alive && setBosses({ s: 'error' }));
    return () => {
      alive = false;
      // If the route changed away before this request settled, the response
      // above will be silently discarded (correctly - it's for a view we've
      // left). But without resetting back to 'idle' here, the guard above
      // would see a permanently stuck 'loading' on return and never start a
      // replacement request. Only reset while still 'loading' - a completed
      // 'loaded'/'error' result should stay cached, not be thrown away.
      setBosses((current) => (current.s === 'loading' ? { s: 'idle' } : current));
    };
  }, [shouldLoadBosses]);

  return bosses;
}
