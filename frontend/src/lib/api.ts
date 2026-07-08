import { isTrackedBoss } from './trackedBosses';

const PRODUCTION_API_BASE_URL = 'https://osrs-pb-tracker-backend.vercel.app';

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

export function resolveApiBaseUrl(
  configuredBaseUrl: string | undefined,
  locationLike: Pick<Location, 'hostname'> | undefined = typeof window === 'undefined' ? undefined : window.location
) {
  if (configuredBaseUrl !== undefined) return configuredBaseUrl;
  if (locationLike?.hostname.startsWith('osrs-pb-tracker-frontend') && locationLike.hostname.endsWith('.vercel.app')) {
    return PRODUCTION_API_BASE_URL;
  }
  return '';
}

// Local dev and integrated deployments keep same-origin /api/... paths when no
// env is configured. Frontend-only Vercel previews fall back to production API
// data so branch reviews are not blank.
export const api = createApiClient(resolveApiBaseUrl(import.meta.env.VITE_API_BASE_URL));
