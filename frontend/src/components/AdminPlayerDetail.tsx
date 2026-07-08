import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { PlayerLookup } from '../lib/api';
import { formatDate, formatTime, titleCase } from '../lib/format';
import { EmptyState, ErrorState, Loading } from './States';

type State = { s: 'loading' } | { s: 'error' } | { s: 'loaded'; lookup: PlayerLookup };

export function AdminPlayerDetail({ playerId, onBack }: { playerId: number; onBack: () => void }) {
  const [state, setState] = useState<State>({ s: 'loading' });

  useEffect(() => {
    let alive = true;
    setState({ s: 'loading' });
    api
      .getPlayerById(playerId)
      .then((lookup) => alive && setState({ s: 'loaded', lookup }))
      .catch(() => alive && setState({ s: 'error' }));
    return () => {
      alive = false;
    };
  }, [playerId]);

  return (
    <section>
      <button type="button" className="admin-back-link" onClick={onBack}>
        &larr; Back to admin
      </button>

      {state.s === 'loading' && <Loading />}
      {state.s === 'error' && <ErrorState />}
      {state.s === 'loaded' && state.lookup.kind !== 'player' && (
        <EmptyState>Player not found.</EmptyState>
      )}
      {state.s === 'loaded' && state.lookup.kind === 'player' && (
        <>
          <h2 className="result-title">{state.lookup.player.displayName}</h2>
          {state.lookup.player.pbs.length === 0 ? (
            <EmptyState>No tracked PBs for this player.</EmptyState>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Boss</th>
                  <th>Personal Best</th>
                  <th>Recorded</th>
                </tr>
              </thead>
              <tbody>
                {state.lookup.player.pbs.map((pb) => (
                  <tr key={pb.boss}>
                    <td data-label="Boss">{titleCase(pb.boss)}</td>
                    <td className="time" data-label="Personal Best">
                      {formatTime(pb.timeSeconds)}
                    </td>
                    <td data-label="Recorded">{formatDate(pb.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </section>
  );
}
