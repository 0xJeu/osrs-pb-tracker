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
    if ((route.name !== 'home' && route.name !== 'boss') || bosses.s !== 'idle') return;
    let alive = true;
    setBosses({ s: 'loading' });
    api.getBosses().then((data) => {
      if (alive) setBosses({ s: 'loaded', data });
    }).catch(() => alive && setBosses({ s: 'error' }));
    return () => { alive = false; };
  }, [route.name, bosses.s]);

  return bosses;
}
