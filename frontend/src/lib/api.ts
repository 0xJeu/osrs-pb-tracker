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
  const searchCache = new Map<string, Promise<string[]>>();

  const inFlight = new Map<string, Promise<unknown>>();
  const sessionCache = new Map<string, { expiresAt: number; value: unknown }>();

  function now() {
    return Date.now();
  }

  async function getJson<T>(path: string, ttlMs = 0): Promise<T> {
    const cached = sessionCache.get(path);
    if (cached && cached.expiresAt > now()) {
      return cached.value as T;
    }

    const pending = inFlight.get(path);
    if (pending) {
      return pending as Promise<T>;
    }

    const request = (async () => {
      const res = await fetchFn(`${base}${path}`);
      if (!res.ok) {
        throw new ApiError(res.status);
      }
      const value = (await res.json()) as T;
      if (ttlMs > 0) {
        if (ttlMs === TTL.search && sessionCache.size >= 200) {
          const oldestKey = sessionCache.keys().next().value;
          if (oldestKey) sessionCache.delete(oldestKey);
        }
        sessionCache.set(path, { expiresAt: now() + ttlMs, value });
      }
      return value;
    })();

    inFlight.set(path, request);
    try {
      return await request;
    } finally {
      inFlight.delete(path);
    }
  }

  function invalidate(path: string) {
    sessionCache.delete(path);
  }

  // Endpoint-specific session TTLs from the compute-wake design (Workstream E).
  const TTL = {
    playerProfile: 5 * 60 * 1000,
    bossList: Number.POSITIVE_INFINITY, // session lifetime
    statsRecentOverview: 2 * 60 * 1000,
    search: 5 * 60 * 1000,
  } as const;

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
      const canonicalName = name.trim().toLowerCase();
      const path = `/api/players/${encodeURIComponent(canonicalName)}`;
      const cached = sessionCache.get(path);
      if (cached && cached.expiresAt > now()) {
        return playerFrom(new Response(JSON.stringify(cached.value), { status: 200 }));
      }
      const res = await fetchFn(`${base}${path}`);
      if (res.ok) {
        const cloned = res.clone();
        void cloned.json().then((value) => sessionCache.set(path, { expiresAt: now() + TTL.playerProfile, value }));
      }
      return playerFrom(res);
    },
    async getPlayerById(id: number): Promise<PlayerLookup> {
      return playerFrom(await fetchFn(`${base}/api/players/by-id/${id}`));
    },
    search(q: string): Promise<string[]> {
      const canonicalQuery = q.trim().toLowerCase();
      if (canonicalQuery.length < 2) {
        return Promise.resolve([]);
      }

      const cached = searchCache.get(canonicalQuery);
      if (cached) return cached;

      const request = getJson<string[]>(`/api/search?q=${encodeURIComponent(canonicalQuery)}`);
      searchCache.set(canonicalQuery, request);
      void request.then(
        () => searchCache.delete(canonicalQuery),
        () => searchCache.delete(canonicalQuery)
      );
      return request;
    },
    async searchAll(q: string): Promise<SearchSuggestion[]> {
      const canonicalQuery = q.trim().toLowerCase();
      if (canonicalQuery.length < 2) {
        return [];
      }
      try {
        return await getJson(`/api/search/all?q=${encodeURIComponent(canonicalQuery)}`, TTL.search);
      } catch {
        // Rolling-deploy fallback: keep the makeover usable while the
        // currently deployed backend still exposes only the legacy routes.
        const [playerNames, bosses] = await Promise.all([
          getJson<string[]>(`/api/search?q=${encodeURIComponent(canonicalQuery)}`).catch(() => []),
          getJson<string[]>('/api/bosses', TTL.bossList).catch(() => []),
        ]);
        return [
          ...playerNames.map((value) => ({ type: 'player' as const, value })),
          ...bosses
            .filter((value) => matchesBossSearch(value, canonicalQuery))
            .map((value) => ({ type: 'boss' as const, value })),
        ];
      }
    },
    async getBosses(): Promise<string[]> {
      const bosses = await getJson<string[]>('/api/bosses', TTL.bossList);
      return bosses.filter(isTrackedBoss);
    },
    getLeaderboard(boss: string, limit = 25, highlight?: string): Promise<LeaderboardRow[]> {
      const canonicalBoss = boss.trim().toLowerCase();
      const canonicalLimit = Math.min(Math.max(Math.floor(limit) || 25, 1), 100);
      const canonicalHighlight = highlight?.trim().toLowerCase();
      const highlightParam = canonicalHighlight
        ? `&highlight=${encodeURIComponent(canonicalHighlight)}`
        : '';
      return getJson(
        `/api/leaderboard/${encodeURIComponent(canonicalBoss)}?limit=${canonicalLimit}${highlightParam}`
      );
    },
    async getLeaderboardPage(boss: string, limit = 50, offset = 0, highlight?: string): Promise<LeaderboardPage> {
      const canonicalBoss = boss.trim().toLowerCase();
      const canonicalLimit = Math.min(Math.max(Math.floor(limit) || 50, 1), 100);
      const canonicalOffset = Math.max(Math.floor(offset) || 0, 0);
      const canonicalHighlight = highlight?.trim().toLowerCase();
      const highlightParam = canonicalHighlight ? `&highlight=${encodeURIComponent(canonicalHighlight)}` : '';
      const path = `/api/leaderboard/${encodeURIComponent(canonicalBoss)}?limit=${canonicalLimit}&offset=${canonicalOffset}${highlightParam}`;
      const data = await getJson<LeaderboardPage | LeaderboardRow[]>(path);
      if (Array.isArray(data)) return { rows: data, total: data.length, limit: canonicalLimit, offset: 0 };
      return data;
    },
    getRecentSyncs(limit = 10): Promise<RecentSync[]> {
      const canonicalLimit = Math.min(Math.max(Math.floor(limit) || 10, 1), 25);
      return getJson(`/api/recent-syncs?limit=${canonicalLimit}`, TTL.statsRecentOverview);
    },
    getStats(): Promise<QuickStats> {
      return getJson('/api/stats', TTL.statsRecentOverview);
    },
    getLeaderboardOverview(): Promise<Array<{ boss: string; leader: LeaderboardRow | null }>> {
      return getJson('/api/leaderboard-overview', TTL.statsRecentOverview);
    },
    invalidatePlayerProfile(name: string) {
      invalidate(`/api/players/${encodeURIComponent(name.trim().toLowerCase())}`);
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
