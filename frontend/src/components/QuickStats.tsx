import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { QuickStats as QuickStatsPayload } from '../lib/api';

type State = { s: 'loading' } | { s: 'error' } | { s: 'loaded'; stats: QuickStatsPayload };

const numberFormatter = new Intl.NumberFormat();

export function QuickStats() {
  const [state, setState] = useState<State>({ s: 'loading' });

  useEffect(() => {
    let alive = true;
    api
      .getStats()
      .then((stats) => alive && setState({ s: 'loaded', stats }))
      .catch(() => alive && setState({ s: 'error' }));
    return () => {
      alive = false;
    };
  }, []);

  if (state.s === 'loading') {
    return <section className="quick-stats muted-panel">Loading quick stats...</section>;
  }

  if (state.s === 'error') {
    return <section className="quick-stats muted-panel">Quick stats are unavailable right now.</section>;
  }

  return (
    <section className="quick-stats" aria-label="Quick stats">
      <div className="section-heading">
        <h2>Quick Stats</h2>
        <span>currently tracked</span>
      </div>
      <div className="quick-stats-grid">
        <div>
          <span>Tracked Players</span>
          <strong>{numberFormatter.format(state.stats.trackedPlayers)}</strong>
        </div>
        <div>
          <span>PB Records</span>
          <strong>{numberFormatter.format(state.stats.personalBestRecords)}</strong>
        </div>
      </div>
    </section>
  );
}
