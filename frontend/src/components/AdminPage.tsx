import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { AdminPlayerSummary, AdminStats } from '../lib/api';
import { formatDate } from '../lib/format';
import { EmptyState, ErrorState, Loading } from './States';

type SortKey = 'displayName' | 'createdAt' | 'lastSyncedAt' | 'pbCount';
type SortDir = 'asc' | 'desc';

type State =
  | { s: 'loading' }
  | { s: 'error' }
  | { s: 'loaded'; players: AdminPlayerSummary[]; stats: AdminStats };

function sortPlayers(rows: AdminPlayerSummary[], key: SortKey, dir: SortDir): AdminPlayerSummary[] {
  const sorted = [...rows].sort((a, b) => {
    const av = a[key];
    const bv = b[key];
    if (typeof av === 'number' && typeof bv === 'number') {
      return av - bv;
    }
    return String(av).localeCompare(String(bv));
  });
  return dir === 'asc' ? sorted : sorted.reverse();
}

export function AdminPage({ onSelectPlayer }: { onSelectPlayer: (id: number) => void }) {
  const [state, setState] = useState<State>({ s: 'loading' });
  const [sortKey, setSortKey] = useState<SortKey>('lastSyncedAt');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  useEffect(() => {
    let alive = true;
    Promise.all([api.getAdminPlayers(), api.getAdminStats()])
      .then(([players, stats]) => alive && setState({ s: 'loaded', players, stats }))
      .catch(() => alive && setState({ s: 'error' }));
    return () => {
      alive = false;
    };
  }, []);

  if (state.s === 'loading') return <Loading />;
  if (state.s === 'error') return <ErrorState />;

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const { stats } = state;
  const rows = sortPlayers(state.players, sortKey, sortDir);

  return (
    <section>
      <h2 className="result-title">Admin</h2>

      <div className="admin-stats">
        <div className="admin-stat">
          <span className="admin-stat-value">{stats.totalPlayers}</span>
          <span className="admin-stat-label">Players</span>
        </div>
        <div className="admin-stat">
          <span className="admin-stat-value">{stats.totalPbs}</span>
          <span className="admin-stat-label">PBs tracked</span>
        </div>
        <div className="admin-stat">
          <span className="admin-stat-value">{stats.playersSyncedLast24h}</span>
          <span className="admin-stat-label">Synced last 24h</span>
        </div>
        <div className="admin-stat">
          <span className="admin-stat-value">{stats.playersInactive7d}</span>
          <span className="admin-stat-label">Inactive 7d+</span>
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState>No players synced yet.</EmptyState>
      ) : (
        <table>
          <thead>
            <tr>
              <th className="admin-sortable" onClick={() => toggleSort('displayName')}>
                Player
              </th>
              <th className="admin-sortable" onClick={() => toggleSort('createdAt')}>
                First sync
              </th>
              <th className="admin-sortable" onClick={() => toggleSort('lastSyncedAt')}>
                Last sync
              </th>
              <th className="admin-sortable" onClick={() => toggleSort('pbCount')}>
                PBs
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id} className="admin-row-clickable" onClick={() => onSelectPlayer(p.id)}>
                <td data-label="Player">{p.displayName}</td>
                <td data-label="First sync">{formatDate(p.createdAt)}</td>
                <td data-label="Last sync">{formatDate(p.lastSyncedAt)}</td>
                <td data-label="PBs">{p.pbCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
