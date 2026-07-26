import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { PbTrackerApp } from '../src/components/PbTrackerApp';
import { api } from '../src/lib/api';

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

describe('per-view request budget', () => {
  let fetchSpy: ReturnType<typeof mockFetch>;

  beforeEach(() => {
    fetchSpy = mockFetch();
    vi.stubGlobal('fetch', fetchSpy);
    api.resetForTesting();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('home view requests bosses, stats, recent-syncs, and one overview call — no per-boss leaderboard fan-out', async () => {
    setPath('/');
    render(<PbTrackerApp />);
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
    render(<PbTrackerApp />);
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith(expect.stringContaining('/api/players/blitzen')));

    const paths = fetchSpy.mock.calls.map(([url]) => String(url));
    expect(paths).toHaveLength(1);
  });

  it('boss view requests bosses and one leaderboard page, no home data', async () => {
    setPath('/boss/zulrah');
    render(<PbTrackerApp />);
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
    render(<PbTrackerApp />);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
