import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useHomeData } from '../src/hooks/useHomeData';
import { api } from '../src/lib/api';
import type { Route } from '../src/hooks/useRoute';

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

describe('useHomeData', () => {
  let resolveStats: (() => void) | undefined;
  let resolveRecentSyncs: (() => void) | undefined;
  let resolveOverview: (() => void) | undefined;

  beforeEach(() => {
    api.resetForTesting();
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/stats')) {
        return new Promise<Response>((resolve) => {
          resolveStats = () => resolve(jsonResponse({ trackedPlayers: 5, personalBestRecords: 20 }));
        });
      }
      if (url.includes('/api/recent-syncs')) {
        return new Promise<Response>((resolve) => {
          resolveRecentSyncs = () => resolve(jsonResponse([]));
        });
      }
      if (url.includes('/api/leaderboard-overview')) {
        return new Promise<Response>((resolve) => {
          resolveOverview = () => resolve(jsonResponse([]));
        });
      }
      return Promise.resolve(jsonResponse([]));
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reaches loaded state for stats, recentSyncs, and topBosses once their delayed fetches resolve', async () => {
    const route: Route = { name: 'home' };
    const { result } = renderHook(() => useHomeData(route));

    await waitFor(() => {
      expect(result.current.stats.s).toBe('loading');
      expect(result.current.recentSyncs.s).toBe('loading');
      expect(result.current.topBosses.s).toBe('loading');
    });

    resolveStats?.();
    resolveRecentSyncs?.();
    resolveOverview?.();

    await waitFor(() => {
      expect(result.current.stats.s).toBe('loaded');
      expect(result.current.recentSyncs.s).toBe('loaded');
      expect(result.current.topBosses.s).toBe('loaded');
    });
  });
});
