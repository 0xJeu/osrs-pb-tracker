export interface PbEntry {
  boss: string;
  timeSeconds: number;
  updatedAt: string;
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

export class ApiError extends Error {
  constructor(public status: number) {
    super(`API error ${status}`);
  }
}

export function createApiClient(baseUrl: string, fetchFn: typeof fetch = fetch) {
  const base = baseUrl.replace(/\/+$/, '');

  async function getJson<T>(path: string): Promise<T> {
    const res = await fetchFn(`${base}${path}`);
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
    return { kind: 'player', player: data as PlayerPayload };
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
    getBosses(): Promise<string[]> {
      return getJson('/api/bosses');
    },
    getLeaderboard(boss: string, limit = 25): Promise<LeaderboardRow[]> {
      return getJson(`/api/leaderboard/${encodeURIComponent(boss)}?limit=${limit}`);
    },
    getRecentSyncs(limit = 10): Promise<RecentSync[]> {
      return getJson(`/api/recent-syncs?limit=${limit}`);
    },
  };
}

// VITE_API_BASE_URL unset -> same-origin /api/... paths, per the spec's
// defined fallback behavior.
export const api = createApiClient(import.meta.env.VITE_API_BASE_URL ?? '');
