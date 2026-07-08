import { isTrackedBoss } from './trackedBosses';

export interface PbEntry {
  boss: string;
  timeSeconds: number;
  updatedAt: string;
  rank: number;
}

export interface PlayerPayload {
  id: number;
  displayName: string;
  updatedAt: string;
  pbs: PbEntry[];
}

export interface AmbiguousMatch {
  id: number;
  displayName: string;
  updatedAt: string;
}

export type PlayerLookup =
  | { kind: 'player'; player: PlayerPayload }
  | { kind: 'ambiguous'; matches: AmbiguousMatch[] }
  | { kind: 'notFound' };

export interface LeaderboardRow {
  displayName: string;
  timeSeconds: number;
  updatedAt: string;
}

export interface RecentSync {
  id: number;
  displayName: string;
  updatedAt: string;
  pbCount: number;
}

export interface AdminPlayerSummary {
  id: number;
  displayName: string;
  createdAt: string;
  lastSyncedAt: string;
  pbCount: number;
}

export interface AdminStats {
  totalPlayers: number;
  totalPbs: number;
  playersSyncedLast24h: number;
  playersInactive7d: number;
}

export interface AdminCredentials {
  username: string;
  password: string;
}

export class ApiError extends Error {
  constructor(public status: number) {
    super(`API error ${status}`);
  }
}

const ADMIN_CREDENTIALS_KEY = 'pb-tracker-admin-credentials';

export function getStoredAdminCredentials(): AdminCredentials | null {
  if (typeof sessionStorage === 'undefined') {
    return null;
  }
  const raw = sessionStorage.getItem(ADMIN_CREDENTIALS_KEY);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<AdminCredentials>;
    if (typeof parsed.username === 'string' && typeof parsed.password === 'string') {
      return { username: parsed.username, password: parsed.password };
    }
  } catch {
    // Ignore malformed session data and fall through to clearing it.
  }
  sessionStorage.removeItem(ADMIN_CREDENTIALS_KEY);
  return null;
}

export function hasStoredAdminCredentials(): boolean {
  return getStoredAdminCredentials() !== null;
}

export function setStoredAdminCredentials(credentials: AdminCredentials): void {
  sessionStorage.setItem(ADMIN_CREDENTIALS_KEY, JSON.stringify(credentials));
}

export function clearStoredAdminCredentials(): void {
  sessionStorage.removeItem(ADMIN_CREDENTIALS_KEY);
}

function basicAuthHeader(credentials: AdminCredentials): string {
  return `Basic ${btoa(`${credentials.username}:${credentials.password}`)}`;
}

export function createApiClient(
  baseUrl: string,
  fetchFn: typeof fetch = fetch,
  getAdminCredentials: () => AdminCredentials | null = getStoredAdminCredentials
) {
  const base = baseUrl.replace(/\/+$/, '');

  async function getJson<T>(path: string): Promise<T> {
    const res = await fetchFn(`${base}${path}`);
    if (!res.ok) {
      throw new ApiError(res.status);
    }
    return res.json() as Promise<T>;
  }

  async function getAdminJson<T>(path: string): Promise<T> {
    const credentials = getAdminCredentials();
    const res = credentials
      ? await fetchFn(`${base}${path}`, { headers: { Authorization: basicAuthHeader(credentials) } })
      : await fetchFn(`${base}${path}`);
    if (!res.ok) {
      throw new ApiError(res.status);
    }
    return res.json() as Promise<T>;
  }

  async function playerFrom(res: Response): Promise<PlayerLookup> {
    if (res.status === 404) {
      return { kind: 'notFound' };
    }
    if (!res.ok) {
      throw new ApiError(res.status);
    }
    const data = await res.json();
    if (data.ambiguous) {
      return { kind: 'ambiguous', matches: data.matches as AmbiguousMatch[] };
    }
    const player = data as PlayerPayload;
    return { kind: 'player', player: { ...player, pbs: player.pbs.filter((pb) => isTrackedBoss(pb.boss)) } };
  }

  return {
    async lookupPlayer(name: string): Promise<PlayerLookup> {
      return playerFrom(await fetchFn(`${base}/api/players/${encodeURIComponent(name)}`));
    },
    async getPlayerById(id: number): Promise<PlayerLookup> {
      return playerFrom(await fetchFn(`${base}/api/players/by-id/${id}`));
    },
    search(q: string): Promise<string[]> {
      return getJson(`/api/search?q=${encodeURIComponent(q)}`);
    },
    async getBosses(): Promise<string[]> {
      const bosses = await getJson<string[]>('/api/bosses');
      return bosses.filter(isTrackedBoss);
    },
    getLeaderboard(boss: string, limit = 25, highlight?: string): Promise<LeaderboardRow[]> {
      const highlightParam = highlight ? `&highlight=${encodeURIComponent(highlight)}` : '';
      return getJson(`/api/leaderboard/${encodeURIComponent(boss)}?limit=${limit}${highlightParam}`);
    },
    getRecentSyncs(limit = 10): Promise<RecentSync[]> {
      return getJson(`/api/recent-syncs?limit=${limit}`);
    },
    getAdminPlayers(): Promise<AdminPlayerSummary[]> {
      return getAdminJson('/api/admin/players');
    },
    getAdminStats(): Promise<AdminStats> {
      return getAdminJson('/api/admin/stats');
    },
    async submitFeedback(message: string, context?: string): Promise<void> {
      const res = await fetchFn(`${base}/api/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(context ? { message, context } : { message }),
      });
      if (!res.ok) {
        throw new ApiError(res.status);
      }
    },
  };
}

// VITE_API_BASE_URL unset -> same-origin /api/... paths, per the spec's
// defined fallback behavior.
export const api = createApiClient(import.meta.env.VITE_API_BASE_URL ?? '');
