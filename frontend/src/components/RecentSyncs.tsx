import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { RecentSync } from '../lib/api';
import { formatDate } from '../lib/format';

type State = { s: 'loading' } | { s: 'error' } | { s: 'loaded'; rows: RecentSync[] };

export function RecentSyncs({ onPickPlayer }: { onPickPlayer: (name: string) => void }) {
  const [state, setState] = useState<State>({ s: 'loading' });

  useEffect(() => {
    let alive = true;
    api
      .getRecentSyncs()
      .then((rows) => alive && setState({ s: 'loaded', rows }))
      .catch(() => alive && setState({ s: 'error' }));
    return () => {
      alive = false;
    };
  }, []);

  if (state.s === 'loading') {
    return <section className="recent-syncs muted-panel">Loading recent syncs...</section>;
  }

  if (state.s === 'error') {
    return <section className="recent-syncs muted-panel">Recent syncs are unavailable right now.</section>;
  }

  if (state.rows.length === 0) {
    return <section className="recent-syncs muted-panel">No recent plugin syncs yet.</section>;
  }

  return (
    <section className="recent-syncs">
      <div className="section-heading">
        <h2>Recent Syncs</h2>
        <span>{state.rows.length} latest</span>
      </div>
      <div className="recent-list">
        {state.rows.map((row) => (
          <button
            key={row.id}
            type="button"
            className="recent-row"
            onClick={() => onPickPlayer(row.displayName)}
          >
            <span>
              <strong>{row.displayName}</strong>
              <small>{formatDate(row.updatedAt)}</small>
            </span>
            <span className="pb-count">{row.pbCount} PBs</span>
          </button>
        ))}
      </div>
    </section>
  );
}
