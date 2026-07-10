import { useEffect, useState } from 'react';
import { ApiError, api, clearStoredAdminCredentials, hasStoredAdminCredentials, setStoredAdminCredentials } from '../lib/api';
import type { AdminPlayerSummary, AdminStats } from '../lib/api';
import { formatDate } from '../lib/format';
import { EmptyState, ErrorState, Loading } from './States';

type SortKey = 'displayName' | 'createdAt' | 'lastSyncedAt' | 'pbCount';
type SortDir = 'asc' | 'desc';

type State =
  | { s: 'login'; message?: string }
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
  const [state, setState] = useState<State>(() => (hasStoredAdminCredentials() ? { s: 'loading' } : { s: 'login' }));
  const [sortKey, setSortKey] = useState<SortKey>('lastSyncedAt');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const loadAdminData = () => {
    let alive = true;
    setState({ s: 'loading' });
    Promise.all([api.getAdminPlayers(), api.getAdminStats()])
      .then(([players, stats]) => alive && setState({ s: 'loaded', players, stats }))
      .catch((error) => {
        if (!alive) return;
        if (error instanceof ApiError && error.status === 401) {
          clearStoredAdminCredentials();
          setState({ s: 'login', message: 'Invalid admin credentials.' });
          return;
        }
        setState({ s: 'error' });
      });
    return () => {
      alive = false;
    };
  };

  useEffect(() => {
    if (!hasStoredAdminCredentials()) {
      setState({ s: 'login' });
      return;
    }
    return loadAdminData();
  }, []);

  if (state.s === 'login') return <AdminLogin message={state.message} onLogin={loadAdminData} />;
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

function AdminLogin({ message, onLogin }: { message?: string; onLogin: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  return (
    <section>
      <h2 className="result-title">Admin</h2>
      <form
        className="admin-login"
        onSubmit={(event) => {
          event.preventDefault();
          setStoredAdminCredentials({ username, password });
          onLogin();
        }}
      >
        <label>
          <span>Username</span>
          <input
            autoComplete="username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            required
          />
        </label>
        <label>
          <span>Password</span>
          <input
            autoComplete="current-password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </label>
        <button type="submit">Log in</button>
        {message ? <p className="admin-login-error">{message}</p> : null}
      </form>
    </section>
  );
}
