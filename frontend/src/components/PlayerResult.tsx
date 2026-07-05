import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { AmbiguousMatch, PlayerPayload } from '../lib/api';
import { formatDate, formatTime, titleCase } from '../lib/format';
import { hideAmbiguousBaseEntries } from '../lib/dedupe';
import { AmbiguousPicker } from './AmbiguousPicker';
import { EmptyState, ErrorState, Loading } from './States';

type State =
  | { s: 'loading' }
  | { s: 'error' }
  | { s: 'notFound' }
  | { s: 'ambiguous'; matches: AmbiguousMatch[] }
  | { s: 'loaded'; player: PlayerPayload };

export function PlayerResult({ name }: { name: string }) {
  const [state, setState] = useState<State>({ s: 'loading' });

  useEffect(() => {
    let alive = true;
    setState({ s: 'loading' });
    api
      .lookupPlayer(name)
      .then((result) => {
        if (!alive) return;
        if (result.kind === 'notFound') setState({ s: 'notFound' });
        else if (result.kind === 'ambiguous') setState({ s: 'ambiguous', matches: result.matches });
        else setState({ s: 'loaded', player: result.player });
      })
      .catch(() => alive && setState({ s: 'error' }));
    return () => {
      alive = false;
    };
  }, [name]);

  const pickById = (id: number) => {
    setState({ s: 'loading' });
    api
      .getPlayerById(id)
      .then((result) => {
        if (result.kind === 'player') setState({ s: 'loaded', player: result.player });
        else setState({ s: 'notFound' });
      })
      .catch(() => setState({ s: 'error' }));
  };

  if (state.s === 'loading') return <Loading />;
  if (state.s === 'error') return <ErrorState />;
  if (state.s === 'notFound') {
    return (
      <EmptyState>
        No PB data found for <strong>{name}</strong> yet. They need to sync with the PB Tracker
        Sync plugin first.
      </EmptyState>
    );
  }
  if (state.s === 'ambiguous') {
    return <AmbiguousPicker name={name} matches={state.matches} onPick={pickById} />;
  }

  const { player } = state;
  if (player.pbs.length === 0) {
    return (
      <EmptyState>
        <strong>{player.displayName}</strong> has synced, but has no recorded PBs yet.
      </EmptyState>
    );
  }

  const visiblePbs = hideAmbiguousBaseEntries(player.pbs, (pb) => pb.boss);

  return (
    <section>
      <h2 className="result-title">{player.displayName}</h2>
      <div className="result-meta">
        Last synced {formatDate(player.updatedAt)} - {visiblePbs.length} PB(s) recorded
      </div>
      <table>
        <thead>
          <tr>
            <th>Boss</th>
            <th>Personal Best</th>
            <th>Recorded</th>
          </tr>
        </thead>
        <tbody>
          {visiblePbs.map((pb) => (
            <tr key={pb.boss}>
              <td data-label="Boss">{titleCase(pb.boss)}</td>
              <td data-label="Personal Best" className="time">
                {formatTime(pb.timeSeconds)}
              </td>
              <td data-label="Recorded">{formatDate(pb.updatedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
