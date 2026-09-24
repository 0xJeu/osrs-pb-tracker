import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useBossList } from '../src/hooks/useBossList';
import { api } from '../src/lib/api';
import type { Route } from '../src/hooks/useRoute';

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' }, ...init });
}

describe('useBossList', () => {
  beforeEach(() => {
    api.resetForTesting();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reaches loaded state once the delayed fetch resolves, not stuck on loading', async () => {
    let resolveFetch: (() => void) | undefined;
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => new Promise<Response>((resolve) => {
      resolveFetch = () => resolve(jsonResponse(['zulrah', 'vorkath']));
    })));

    const route: Route = { name: 'home' };
    const { result } = renderHook(() => useBossList(route));

    await waitFor(() => expect(result.current.s).toBe('loading'));
    resolveFetch?.();

    await waitFor(() => expect(result.current.s).toBe('loaded'));
    expect(result.current).toMatchObject({ s: 'loaded', data: ['zulrah', 'vorkath'] });
  });

  it('reaches error state once a delayed fetch rejects, not stuck on loading', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'boom' }, { status: 500 })));

    const route: Route = { name: 'home' };
    const { result } = renderHook(() => useBossList(route));

    await waitFor(() => expect(result.current.s).toBe('error'));
  });

  it('recovers to idle after leaving mid-fetch, and reaches loaded on return, rather than staying stuck on loading', async () => {
    let resolveFetch: (() => void) | undefined;
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => new Promise<Response>((resolve) => {
      resolveFetch = () => resolve(jsonResponse(['zulrah']));
    })));

    const { result, rerender } = renderHook(({ route }: { route: Route }) => useBossList(route), {
      initialProps: { route: { name: 'home' } as Route },
    });
    await waitFor(() => expect(result.current.s).toBe('loading'));

    // Leave before the request settles. The idle guard must not be left
    // permanently stuck on 'loading' - a stranded 'loading' would block any
    // future attempt to fetch, on this visit or any later one.
    rerender({ route: { name: 'faq' } as Route });
    await waitFor(() => expect(result.current.s).toBe('idle'));

    // Coming back must restart loading rather than staying idle forever.
    rerender({ route: { name: 'home' } as Route });
    await waitFor(() => expect(result.current.s).toBe('loading'));

    // Whether this reuses the original in-flight request (api.ts coalesces
    // identical in-flight GETs) or issues a new one, resolving it must
    // actually reach 'loaded' - not stay stranded a second time.
    resolveFetch?.();
    await waitFor(() => expect(result.current.s).toBe('loaded'));
    expect(result.current).toMatchObject({ s: 'loaded', data: ['zulrah'] });
  });

  it('preserves the pending request when navigating directly from Home to Boss', async () => {
    let resolveFetch: (() => void) | undefined;
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => new Promise<Response>((resolve) => {
      resolveFetch = () => resolve(jsonResponse(['zulrah']));
    })));

    const { result, rerender } = renderHook(({ route }: { route: Route }) => useBossList(route), {
      initialProps: { route: { name: 'home' } as Route },
    });
    await waitFor(() => expect(result.current.s).toBe('loading'));

    rerender({ route: { name: 'boss', boss: 'zulrah' } as Route });
    expect(result.current.s).toBe('loading');

    resolveFetch?.();
    await waitFor(() => expect(result.current.s).toBe('loaded'));
    expect(result.current).toMatchObject({ s: 'loaded', data: ['zulrah'] });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  describe('refreshing a loaded list', () => {
    let nowSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    });

    afterEach(() => {
      nowSpy.mockRestore();
    });

    function becomeVisible() {
      act(() => {
        document.dispatchEvent(new Event('visibilitychange'));
      });
    }

    it('picks up a newly synced boss when the tab becomes visible after the cache expires', async () => {
      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce(jsonResponse(['zulrah']))
        .mockResolvedValueOnce(jsonResponse(['doom of mokhaiotl - delve 1', 'zulrah'])));

      const { result } = renderHook(() => useBossList({ name: 'leaderboards' }));
      await waitFor(() => expect(result.current).toMatchObject({ s: 'loaded', data: ['zulrah'] }));

      becomeVisible();
      expect(result.current).toMatchObject({ s: 'loaded', data: ['zulrah'] });
      expect(fetch).toHaveBeenCalledTimes(1);

      nowSpy.mockReturnValue(1_000_000 + 10 * 60 * 1000 + 1);
      becomeVisible();
      expect(result.current.s).toBe('loaded');
      await waitFor(() => expect(result.current).toMatchObject({
        s: 'loaded',
        data: ['doom of mokhaiotl - delve 1', 'zulrah'],
      }));
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('refreshes an expired list when returning to a view that needs it', async () => {
      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce(jsonResponse(['zulrah']))
        .mockResolvedValueOnce(jsonResponse(['doom of mokhaiotl - delve 1', 'zulrah'])));

      const { result, rerender } = renderHook(({ route }: { route: Route }) => useBossList(route), {
        initialProps: { route: { name: 'leaderboards' } as Route },
      });
      await waitFor(() => expect(result.current).toMatchObject({ s: 'loaded', data: ['zulrah'] }));

      rerender({ route: { name: 'faq' } as Route });
      nowSpy.mockReturnValue(1_000_000 + 10 * 60 * 1000 + 1);
      rerender({ route: { name: 'leaderboards' } as Route });

      await waitFor(() => expect(result.current).toMatchObject({
        s: 'loaded',
        data: ['doom of mokhaiotl - delve 1', 'zulrah'],
      }));
    });

    it('keeps showing the loaded list when a background refresh fails', async () => {
      vi.stubGlobal('fetch', vi.fn()
        .mockResolvedValueOnce(jsonResponse(['zulrah']))
        .mockResolvedValueOnce(jsonResponse({ error: 'boom' }, { status: 500 })));

      const { result } = renderHook(() => useBossList({ name: 'leaderboards' }));
      await waitFor(() => expect(result.current).toMatchObject({ s: 'loaded', data: ['zulrah'] }));

      nowSpy.mockReturnValue(1_000_000 + 10 * 60 * 1000 + 1);
      becomeVisible();
      await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
      await Promise.resolve();
      expect(result.current).toMatchObject({ s: 'loaded', data: ['zulrah'] });
    });
  });
});
