import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { PlayerPayload } from '../lib/api';
import type { Route } from './useRoute';

export type PlayerState =
  | { s: 'idle' }
  | { s: 'loading'; name: string }
  | { s: 'error'; name: string }
  | { s: 'notFound'; name: string }
  | { s: 'ambiguous'; name: string; count: number }
  | { s: 'loaded'; player: PlayerPayload };

export function usePlayerProfile(route: Route): PlayerState {
  const [profileState, setProfileState] = useState<PlayerState>({ s: 'idle' });

  useEffect(() => {
    if (route.name !== 'player') return;
    let alive = true;
    const trimmed = route.player.trim();
    setProfileState({ s: 'loading', name: trimmed });
    api.lookupPlayer(trimmed).then((result) => {
      if (!alive) return;
      if (result.kind === 'player') {
        setProfileState({ s: 'loaded', player: result.player });
        if (result.player.displayName.toLowerCase() !== trimmed.toLowerCase()) {
          window.history.replaceState({}, '', `/player/${encodeURIComponent(result.player.displayName)}`);
        }
      }
      else if (result.kind === 'ambiguous') setProfileState({ s: 'ambiguous', name: trimmed, count: result.matches.length });
      else setProfileState({ s: 'notFound', name: trimmed });
    }).catch(() => alive && setProfileState({ s: 'error', name: trimmed }));
    return () => { alive = false; };
  }, [route]);

  return profileState;
}
