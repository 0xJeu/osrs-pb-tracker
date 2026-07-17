import { isTrackedBoss } from './trackedBosses';
import { matchesBossSearch } from './bossAliases';

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

export interface QuickStats {
  trackedPlayers: number;
  personalBestRecords: number;
}

export interface SearchSuggestion {
  type: 'player' | 'boss';
  value: string;
  label?: string;
}

export interface LeaderboardPage {
  rows: LeaderboardRow[];
  total: number;
  limit: number;
  offset: number;
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
    async searchAll(q: string): Promise<SearchSuggestion[]> {
      try {
        return await getJson(`/api/search/all?q=${encodeURIComponent(q)}`);
      } catch {
        // Rolling-deploy fallback: keep the makeover usable while the
        // currently deployed backend still exposes only the legacy routes.
        const [playerNames, bosses] = await Promise.all([
          getJson<string[]>(`/api/search?q=${encodeURIComponent(q)}`).catch(() => []),
          getJson<string[]>('/api/bosses').catch(() => []),
        ]);
        return [
          ...playerNames.map((value) => ({ type: 'player' as const, value })),
          ...bosses
            .filter((value) => matchesBossSearch(value, q))
            .map((value) => ({ type: 'boss' as const, value })),
        ];
      }
    },
    async getBosses(): Promise<string[]> {
      const bosses = await getJson<string[]>('/api/bosses');
      return bosses.filter(isTrackedBoss);
    },
    getLeaderboard(boss: string, limit = 25, highlight?: string): Promise<LeaderboardRow[]> {
      const highlightParam = highlight ? `&highlight=${encodeURIComponent(highlight)}` : '';
      return getJson(`/api/leaderboard/${encodeURIComponent(boss)}?limit=${limit}${highlightParam}`);
    },
    async getLeaderboardPage(boss: string, limit = 50, offset = 0, highlight?: string): Promise<LeaderboardPage> {
      const highlightParam = highlight ? `&highlight=${encodeURIComponent(highlight)}` : '';
      const data = await getJson<LeaderboardPage | LeaderboardRow[]>(
        `/api/leaderboard/${encodeURIComponent(boss)}?limit=${limit}&offset=${offset}${highlightParam}`
      );
      if (Array.isArray(data)) return { rows: data, total: data.length, limit, offset: 0 };
      return data;
    },
    getRecentSyncs(limit = 10): Promise<RecentSync[]> {
      return getJson(`/api/recent-syncs?limit=${limit}`);
    },
    getStats(): Promise<QuickStats> {
      return getJson('/api/stats');
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
