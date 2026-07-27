import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
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
});
