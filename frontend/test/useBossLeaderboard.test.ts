import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { selectDisplayLeaderboard, useBossLeaderboard } from '../src/hooks/useBossLeaderboard';
import { api } from '../src/lib/api';
import type { Route } from '../src/hooks/useRoute';

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

function leaderboardPage(displayName: string) {
  return { rows: [{ displayName, timeSeconds: 10, updatedAt: '2026-07-26T00:00:00.000Z' }], total: 1, limit: 50, offset: 0 };
}

describe('selectDisplayLeaderboard', () => {
  // This is the actual fix for the stale-leaderboard-flash bug: React runs
  // useEffect callbacks after painting, so a render can legitimately happen
  // where `selectedBoss` has already moved on to a new boss but the
  // leaderboard-fetch effect for that new boss hasn't run yet. Testing this
  // moment through the hook itself doesn't work - React Testing Library's
  // `act()` flushes pending effects synchronously before `rerender()`
  // returns, which erases exactly the timing gap this bug lives in. Testing
  // the pure derivation directly instead is deterministic and actually
  // exercises the fix.

  it('returns the real leaderboard when it was fetched for the currently selected boss', () => {
    const loaded = { s: 'loaded' as const, data: leaderboardPage('ZulrahPlayer') };
    expect(selectDisplayLeaderboard('zulrah', 'zulrah', loaded)).toBe(loaded);
  });

  it('forces loading when the cached leaderboard belongs to a different, previously-selected boss', () => {
    const staleVorkathData = { s: 'loaded' as const, data: leaderboardPage('VorkathPlayer') };
    expect(selectDisplayLeaderboard('zulrah', 'vorkath', staleVorkathData)).toEqual({ s: 'loading' });
  });

  it('forces loading when a stale error belongs to a different, previously-selected boss', () => {
    // Otherwise a "Leaderboard unavailable" message for the old boss could
    // flash under the new boss's title while its fetch is still pending.
    expect(selectDisplayLeaderboard('zulrah', 'vorkath', { s: 'error' })).toEqual({ s: 'loading' });
  });

  it('forces loading before any boss has ever been fetched', () => {
    expect(selectDisplayLeaderboard('zulrah', null, { s: 'idle' })).toEqual({ s: 'loading' });
  });

  it('passes through a genuine error for the currently selected boss', () => {
    expect(selectDisplayLeaderboard('zulrah', 'zulrah', { s: 'error' })).toEqual({ s: 'error' });
  });
});

describe('useBossLeaderboard', () => {
  let resolveZulrah: (() => void) | undefined;

  beforeEach(() => {
    api.resetForTesting();
    resolveZulrah = undefined;
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/leaderboard/vorkath')) {
        return Promise.resolve(jsonResponse(leaderboardPage('VorkathPlayer')));
      }
      if (url.includes('/api/leaderboard/zulrah')) {
        return new Promise<Response>((resolve) => {
          resolveZulrah = () => resolve(jsonResponse(leaderboardPage('ZulrahPlayer')));
        });
      }
      return Promise.resolve(jsonResponse([]));
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('ends up showing the newly selected boss after navigating from one boss to another', async () => {
    const bosses = { s: 'loaded' as const, data: ['vorkath', 'zulrah'] };
    const { result, rerender } = renderHook(
      ({ route }: { route: Route }) => useBossLeaderboard(route, bosses),
      { initialProps: { route: { name: 'boss', boss: 'vorkath' } as Route } }
    );

    await waitFor(() => expect(result.current.rows).toHaveLength(1));
    expect(result.current.rows[0].displayName).toBe('VorkathPlayer');

    rerender({ route: { name: 'boss', boss: 'zulrah' } as Route });
    resolveZulrah?.();

    await waitFor(() => expect(result.current.rows[0]?.displayName).toBe('ZulrahPlayer'));
    expect(result.current.selectedBoss).toBe('zulrah');
  });
});
