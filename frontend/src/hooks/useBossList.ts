import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { LoadState } from '../lib/loadState';
import type { Route } from './useRoute';

// Needed on home (for search-alias resolution) and boss (for the picker)
// views. Other views may still get boss suggestions from universal search
// without preloading the full list.
export function useBossList(route: Route): LoadState<string[]> {
  const [bosses, setBosses] = useState<LoadState<string[]>>({ s: 'idle' });

  useEffect(() => {
    // Deliberately NOT depending on bosses.s: this effect's own
    // setBosses({s:'loading'}) call changes that value, and if it were a
    // dependency React would re-run this effect (tearing down the in-flight
    // request's `alive` flag) before the real fetch had a chance to settle -
    // the loading state would never resolve. Reading bosses.s from the
    // closure at run time still gets the guard right on the initial mount
    // and on every subsequent route change that re-triggers this effect.
    if ((route.name !== 'home' && route.name !== 'boss') || bosses.s !== 'idle') return;
    let alive = true;
    setBosses({ s: 'loading' });
    api.getBosses().then((data) => {
      if (alive) setBosses({ s: 'loaded', data });
    }).catch(() => alive && setBosses({ s: 'error' }));
    return () => { alive = false; };
  }, [route.name]);

  return bosses;
}
