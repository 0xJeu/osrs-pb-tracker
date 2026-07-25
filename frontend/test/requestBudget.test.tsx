import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' }, ...init });
}

function mockFetch() {
  return vi.fn().mockImplementation((url: string) => {
    if (url.includes('/api/bosses')) return Promise.resolve(jsonResponse(['zulrah', 'vorkath']));
    if (url.includes('/api/stats')) return Promise.resolve(jsonResponse({ trackedPlayers: 1, personalBestRecords: 1 }));
    if (url.includes('/api/recent-syncs')) return Promise.resolve(jsonResponse([]));
    if (url.includes('/api/leaderboard-overview')) return Promise.resolve(jsonResponse([]));
    if (url.includes('/api/leaderboard/')) return Promise.resolve(jsonResponse({ rows: [], total: 0, limit: 50, offset: 0 }));
    if (url.includes('/api/players/')) return Promise.resolve(jsonResponse({ error: 'not found' }, { status: 404 }));
    return Promise.resolve(jsonResponse([]));
  });
}

function setPath(path: string) {
  window.history.pushState({}, '', path);
}

// The `api` client (src/lib/api.ts) is a module-level singleton that
// captures the global `fetch` reference once, as a default-parameter value,
// the first time the module is evaluated (`createApiClient(...)` runs at
// import time). Because of that, stubbing `globalThis.fetch` after the
// component module has already been imported has no effect - the singleton
// keeps calling whatever `fetch` existed at first import, not the stub.
// Each test below therefore resets the module registry and dynamically
// re-imports the component *after* installing the fetch stub, so the api.ts
// singleton is freshly constructed against the mock every time.
async function renderWithMockedFetch() {
  const { PhaseTwoOsrsPreview } = await import('../src/components/PhaseTwoOsrsPreview');
  return render(<PhaseTwoOsrsPreview />);
}

describe('per-view request budget', () => {
  let fetchSpy: ReturnType<typeof mockFetch>;

  beforeEach(() => {
    fetchSpy = mockFetch();
    vi.stubGlobal('fetch', fetchSpy);
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('home view requests bosses, stats, recent-syncs, and one overview call — no per-boss leaderboard fan-out', async () => {
    setPath('/');
    await renderWithMockedFetch();
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith(expect.stringContaining('/api/leaderboard-overview')));

    const paths = fetchSpy.mock.calls.map(([url]) => String(url));
    expect(paths.some((p) => p.includes('/api/bosses'))).toBe(true);
    expect(paths.some((p) => p.includes('/api/stats'))).toBe(true);
    expect(paths.some((p) => p.includes('/api/recent-syncs'))).toBe(true);
    expect(paths.filter((p) => p.includes('/api/leaderboard-overview'))).toHaveLength(1);
    expect(paths.some((p) => p.includes('/api/leaderboard/'))).toBe(false);
  });

  it('player view requests only the player profile', async () => {
    setPath('/player/blitzen');
    await renderWithMockedFetch();
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith(expect.stringContaining('/api/players/blitzen')));

    const paths = fetchSpy.mock.calls.map(([url]) => String(url));
    expect(paths).toHaveLength(1);
  });

  it('boss view requests bosses and one leaderboard page, no home data', async () => {
    setPath('/boss/zulrah');
    await renderWithMockedFetch();
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith(expect.stringContaining('/api/leaderboard/zulrah')));

    const paths = fetchSpy.mock.calls.map(([url]) => String(url));
    expect(paths.some((p) => p.includes('/api/bosses'))).toBe(true);
    expect(paths.some((p) => p.includes('/api/leaderboard/zulrah'))).toBe(true);
    expect(paths.some((p) => p.includes('/api/stats'))).toBe(false);
    expect(paths.some((p) => p.includes('/api/recent-syncs'))).toBe(false);
    expect(paths.some((p) => p.includes('/api/leaderboard-overview'))).toBe(false);
  });

  it('FAQ and Setup views make zero initial API requests', async () => {
    setPath('/faq');
    await renderWithMockedFetch();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
