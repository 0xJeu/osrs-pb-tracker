import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { LeaderboardRow } from '../lib/api';
import { formatDate, formatTime, titleCase } from '../lib/format';
import { EmptyState, ErrorState, Loading } from './States';

type State = { s: 'loading' } | { s: 'error' } | { s: 'loaded'; rows: LeaderboardRow[] };

export function Leaderboard({ boss }: { boss: string }) {
  const [state, setState] = useState<State>({ s: 'loading' });

  useEffect(() => {
    let alive = true;
    setState({ s: 'loading' });
    api
      .getLeaderboard(boss)
      .then((rows) => alive && setState({ s: 'loaded', rows }))
      .catch(() => alive && setState({ s: 'error' }));
    return () => {
      alive = false;
    };
  }, [boss]);

  if (state.s === 'loading') return <Loading />;
  if (state.s === 'error') return <ErrorState />;
  if (state.rows.length === 0) {
    return (
      <EmptyState>
        No synced PBs for <strong>{titleCase(boss)}</strong> yet.
      </EmptyState>
    );
  }

  return (
    <section>
      <h2 className="result-title">{titleCase(boss)} - Top times</h2>
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Player</th>
            <th>Personal Best</th>
            <th>Recorded</th>
          </tr>
        </thead>
        <tbody>
          {state.rows.map((r, i) => (
            <tr key={`${r.displayName}-${i}`}>
              <td className="rank" data-label="#">
                {i + 1}
              </td>
              <td data-label="Player">{r.displayName}</td>
              <td className="time" data-label="Personal Best">
                {formatTime(r.timeSeconds)}
              </td>
              <td data-label="Recorded">{formatDate(r.updatedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
