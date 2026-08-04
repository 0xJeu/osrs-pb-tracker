import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, createApiClient } from '../src/lib/api';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('createApiClient', () => {
  it('strips trailing slashes from the base URL', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse([]));
    const api = createApiClient('http://api.test///', fetchFn);
    await api.getBosses();
    expect(fetchFn).toHaveBeenCalledWith('http://api.test/api/bosses');
  });

  it('uses same-origin relative paths for an empty base URL', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse([]));
    const api = createApiClient('', fetchFn);
    await api.getBosses();
    expect(fetchFn).toHaveBeenCalledWith('/api/bosses');
  });

  it('maps a 404 player lookup to notFound', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ error: 'Player not found' }, 404));
    const api = createApiClient('', fetchFn);
    expect(await api.lookupPlayer('Nobody')).toEqual({ kind: 'notFound' });
    expect(fetchFn).toHaveBeenCalledWith('/api/players/nobody');
  });

  it('maps an ambiguous response to its matches', async () => {
    const matches = [{ id: 1, displayName: 'Blitzen', updatedAt: '2026-07-04T00:00:00Z' }];
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ ambiguous: true, matches }));
    const api = createApiClient('', fetchFn);
    expect(await api.lookupPlayer('Blitzen')).toEqual({ kind: 'ambiguous', matches });
  });

  it('maps a full payload to a player result', async () => {
    const player = {
      id: 1,
      displayName: 'Blitzen',
      updatedAt: '2026-07-04T00:00:00Z',
      pbs: [{ boss: 'zulrah', timeSeconds: 80, updatedAt: '2026-07-04T00:00:00Z', rank: 1 }],
    };
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(player));
    const api = createApiClient('', fetchFn);
    expect(await api.lookupPlayer('Blitzen')).toEqual({ kind: 'player', player });
  });

  it('drops PBs for bosses with no official Jagex personal best', async () => {
    const player = {
      id: 1,
      displayName: 'Blitzen',
      updatedAt: '2026-07-04T00:00:00Z',
      pbs: [
        { boss: 'zulrah', timeSeconds: 80, updatedAt: '2026-07-04T00:00:00Z', rank: 1 },
        { boss: 'dagannoth prime', timeSeconds: 60, updatedAt: '2026-07-04T00:00:00Z', rank: 1 },
      ],
    };
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(player));
    const api = createApiClient('', fetchFn);
    const result = await api.lookupPlayer('Blitzen');
    expect(result).toEqual({
      kind: 'player',
      player: { ...player, pbs: [player.pbs[0]] },
    });
  });

  it('drops untracked bosses from the boss list', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(['zulrah', 'dagannoth prime', 'vorkath']));
    const api = createApiClient('', fetchFn);
    expect(await api.getBosses()).toEqual(['zulrah', 'vorkath']);
  });

  it('URL-encodes names and bosses', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse([]));
    const api = createApiClient('', fetchFn);
    await api.getLeaderboard('theatre of blood - fastest room (4 player)');
    expect(fetchFn).toHaveBeenCalledWith(
      '/api/leaderboard/theatre%20of%20blood%20-%20fastest%20room%20(4%20player)?limit=25'
    );
  });

  it('forwards a highlight name as a query param when provided', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse([]));
    const api = createApiClient('', fetchFn);
    await api.getLeaderboard('zulrah', 25, 'Blitzen');
    expect(fetchFn).toHaveBeenCalledWith('/api/leaderboard/zulrah?limit=25&highlight=blitzen');
  });

  it('canonicalizes and deduplicates concurrent player searches', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(['Blitzen']));
    const api = createApiClient('', fetchFn);

    const [first, second] = await Promise.all([api.search(' BlIt '), api.search('BLIT')]);
    expect(first).toEqual(['Blitzen']);
    expect(second).toEqual(['Blitzen']);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn).toHaveBeenCalledWith('/api/search?q=blit');
  });

  it('does not request suggestions for fewer than two characters', async () => {
    const fetchFn = vi.fn();
    const api = createApiClient('', fetchFn);
    expect(await api.search('a')).toEqual([]);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('clamps leaderboard and recent-sync limits to canonical cache keys', async () => {
    const fetchFn = vi.fn().mockImplementation(async () => jsonResponse([]));
    const api = createApiClient('', fetchFn);

    await api.getLeaderboard(' Zulrah ', 999);
    await api.getRecentSyncs(999);

    expect(fetchFn).toHaveBeenNthCalledWith(1, '/api/leaderboard/zulrah?limit=100');
    expect(fetchFn).toHaveBeenNthCalledWith(2, '/api/recent-syncs?limit=25');
  });

  it('loads typed universal-search suggestions', async () => {
    const suggestions = [{ type: 'boss', value: 'phantom muspah' }];
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(suggestions));
    const api = createApiClient('', fetchFn);
    expect(await api.searchAll('muspah')).toEqual(suggestions);
    expect(fetchFn).toHaveBeenCalledWith('/api/search/all?q=muspah');
  });

  it('drops untracked bosses from universal-search suggestions', async () => {
    const suggestions = [
      { type: 'player' as const, value: 'Dag Fan' },
      { type: 'boss' as const, value: 'dagannoth prime' },
      { type: 'boss' as const, value: 'phantom muspah' },
      { type: 'boss' as const, value: 'prifddinas agility course' },
    ];
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(suggestions));
    const api = createApiClient('', fetchFn);

    expect(await api.searchAll('dag')).toEqual([
      { type: 'player', value: 'Dag Fan' },
      { type: 'boss', value: 'phantom muspah' },
    ]);
  });

  it('loads a paginated leaderboard page', async () => {
    const page = { rows: [], total: 80, limit: 50, offset: 50 };
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(page));
    const api = createApiClient('', fetchFn);
    expect(await api.getLeaderboardPage('zulrah', 50, 50, 'Blitzen')).toEqual(page);
    expect(fetchFn).toHaveBeenCalledWith('/api/leaderboard/zulrah?limit=50&offset=50&highlight=blitzen');
  });

  it('accepts a legacy leaderboard array during a rolling backend deploy', async () => {
    const rows = [{ displayName: 'Blitzen', timeSeconds: 80, updatedAt: '2026-07-04T18:00:00.000Z' }];
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(rows));
    const api = createApiClient('', fetchFn);
    expect(await api.getLeaderboardPage('zulrah', 50, 0)).toEqual({
      rows,
      total: 1,
      limit: 50,
      offset: 0,
    });
  });

  it('falls back to legacy player and boss search when universal search is unavailable', async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: 'Not found' }, 404))
      .mockResolvedValueOnce(jsonResponse(['Blitzen']))
      .mockResolvedValueOnce(jsonResponse(['phantom muspah', 'zulrah']));
    const api = createApiClient('', fetchFn);
    expect(await api.searchAll('muspah')).toEqual([
      { type: 'player', value: 'Blitzen' },
      { type: 'boss', value: 'phantom muspah' },
    ]);
  });

  it('uses boss aliases in the legacy universal-search fallback', async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: 'Not found' }, 404))
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse(['tombs of amascut', 'zulrah']));
    const api = createApiClient('', fetchFn);
    expect(await api.searchAll('toa')).toEqual([
      { type: 'boss', value: 'tombs of amascut' },
    ]);
  });

  it('loads recent sync summaries with a clamped default limit', async () => {
    const rows = [{ id: 5, displayName: 'ChampSide', updatedAt: '2026-07-05T19:35:04Z', pbCount: 24 }];
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(rows));
    const api = createApiClient('', fetchFn);
    expect(await api.getRecentSyncs()).toEqual(rows);
    expect(fetchFn).toHaveBeenCalledWith('/api/recent-syncs?limit=10');
  });

  it('loads quick stats for the home page panel', async () => {
    const stats = { trackedPlayers: 1284, personalBestRecords: 18492 };
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(stats));
    const api = createApiClient('', fetchFn);
    expect(await api.getStats()).toEqual(stats);
    expect(fetchFn).toHaveBeenCalledWith('/api/stats');
  });

  it('throws on unexpected server errors', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ error: 'Internal error' }, 500));
    const api = createApiClient('', fetchFn);
    await expect(api.getBosses()).rejects.toThrow();
  });

  it('posts feedback without a context field when none is given', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    const api = createApiClient('', fetchFn);
    await api.submitFeedback('Colosseum PB never synced.');
    expect(fetchFn).toHaveBeenCalledWith('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Colosseum PB never synced.' }),
    });
  });

  it('posts feedback with a context field when given', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    const api = createApiClient('', fetchFn);
    await api.submitFeedback('Wrong time shown.', 'boss:zulrah');
    expect(fetchFn).toHaveBeenCalledWith('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Wrong time shown.', context: 'boss:zulrah' }),
    });
  });

  it('throws when feedback submission fails', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ error: 'Too many requests' }, 429));
    const api = createApiClient('', fetchFn);
    await expect(api.submitFeedback('spam')).rejects.toThrow();
  });
});

describe('request coalescing and session caching', () => {
  it('coalesces two identical in-flight GETs into one fetch call', async () => {
    let resolveFetch: (res: Response) => void;
    const fetchFn = vi.fn().mockImplementation(
      () => new Promise<Response>((resolve) => { resolveFetch = resolve; })
    );
    const api = createApiClient('', fetchFn);

    const first = api.getStats();
    const second = api.getStats();
    resolveFetch!(jsonResponse({ trackedPlayers: 1, personalBestRecords: 2 }));

    await Promise.all([first, second]);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('serves a repeated boss-list request from the session cache without refetching', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(['zulrah']));
    const api = createApiClient('', fetchFn);

    await api.getBosses();
    await api.getBosses();
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('coalesces concurrent player lookups and reuses the successful profile cache', async () => {
    let resolveFetch: (res: Response) => void;
    const fetchFn = vi.fn().mockImplementation(
      () => new Promise<Response>((resolve) => { resolveFetch = resolve; })
    );
    const api = createApiClient('', fetchFn);
    const player = {
      id: 1,
      displayName: 'Blitzen',
      updatedAt: '2026-07-04T00:00:00Z',
      pbs: [{ boss: 'zulrah', timeSeconds: 80, updatedAt: '2026-07-04T00:00:00Z', rank: 1 }],
    };

    const first = api.lookupPlayer(' Blitzen ');
    const second = api.lookupPlayer('BLITZEN');
    expect(fetchFn).toHaveBeenCalledTimes(1);

    resolveFetch!(jsonResponse(player));
    await expect(Promise.all([first, second])).resolves.toEqual([
      { kind: 'player', player },
      { kind: 'player', player },
    ]);

    await expect(api.lookupPlayer('blitzen')).resolves.toEqual({ kind: 'player', player });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('does not cache a rejected request, so a retry can succeed', async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(new Response('err', { status: 500 }))
      .mockResolvedValueOnce(jsonResponse({ trackedPlayers: 1, personalBestRecords: 2 }));
    const api = createApiClient('', fetchFn);

    await expect(api.getStats()).rejects.toThrow();
    await expect(api.getStats()).resolves.toEqual({ trackedPlayers: 1, personalBestRecords: 2 });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('builds a canonical leaderboard-page URL: trimmed/lowercased boss, clamped limit/offset, ordered params', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ rows: [], total: 0, limit: 50, offset: 0 }));
    const api = createApiClient('', fetchFn);

    await api.getLeaderboardPage('  Zulrah  ', 500, -5, '  Blitzen  ');
    expect(fetchFn).toHaveBeenCalledWith('/api/leaderboard/zulrah?limit=100&offset=0&highlight=blitzen');
  });
});

describe('searchAll request controls', () => {
  it('rejects queries under two characters without calling fetch', async () => {
    const fetchFn = vi.fn();
    const api = createApiClient('', fetchFn);
    expect(await api.searchAll('a')).toEqual([]);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('caches a successful searchAll result for repeated identical queries', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse([{ type: 'player', value: 'blitzen' }]));
    const api = createApiClient('', fetchFn);
    await api.searchAll('blitzen');
    await api.searchAll('blitzen');
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('canonicalizes the query before building the URL', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse([]));
    const api = createApiClient('', fetchFn);
    await api.searchAll('  Blitzen  ');
    expect(fetchFn).toHaveBeenCalledWith('/api/search/all?q=blitzen');
  });

  it('forwards cancellation and does not start the legacy fallback after an abort', async () => {
    const fetchFn = vi.fn().mockImplementation((_url: string, init?: RequestInit) => (
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'));
        });
      })
    ));
    const api = createApiClient('', fetchFn);
    const controller = new AbortController();

    const request = api.searchAll('blitzen', { signal: controller.signal });
    controller.abort();

    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn).toHaveBeenCalledWith('/api/search/all?q=blitzen', { signal: controller.signal });
  });

  it('does not amplify a universal-search server failure with legacy fallback requests', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ error: 'Internal error' }, 500));
    const api = createApiClient('', fetchFn);

    await expect(api.searchAll('blitzen')).rejects.toMatchObject({ status: 500 });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn).toHaveBeenCalledWith('/api/search/all?q=blitzen');
  });

  it('uses a bounded LRU search cache while sparing other cached endpoints', async () => {
    const fetchFn = vi.fn().mockImplementation(async (url: string) => {
      if (url === '/api/bosses') return jsonResponse(['zulrah']);
      return jsonResponse([{ type: 'player', value: 'p' }]);
    });
    const api = createApiClient('', fetchFn);

    // Prime a session-lifetime, non-search cache entry first (like the boss
    // list would be at session start).
    await api.getBosses();
    expect(fetchFn).toHaveBeenCalledTimes(1);

    // Fill the 200-entry search cache.
    for (let i = 0; i < 200; i++) {
      await api.searchAll(`query-${i}`);
    }
    expect(fetchFn).toHaveBeenCalledTimes(1 + 200);

    // Touch query-0 so query-1 becomes the least recently used entry, then
    // add one new query to force exactly one eviction.
    await api.searchAll('query-0');
    await api.searchAll('query-200');
    expect(fetchFn).toHaveBeenCalledTimes(1 + 201);

    // query-1 was evicted, while the recently touched query-0 remains cached.
    await api.searchAll('query-1');
    expect(fetchFn).toHaveBeenCalledTimes(1 + 201 + 1);
    await api.searchAll('query-0');
    expect(fetchFn).toHaveBeenCalledTimes(1 + 201 + 1);

    // The boss-list entry must remain a cache hit too.
    await api.getBosses();
    expect(fetchFn).toHaveBeenCalledTimes(1 + 201 + 1);
  });
});

describe('the default exported api singleton', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('routes requests through the currently-stubbed global fetch, not the fetch bound at module import time', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(['zulrah']));
    vi.stubGlobal('fetch', fetchFn);

    expect(await api.getBosses()).toEqual(['zulrah']);
    expect(fetchFn).toHaveBeenCalledWith('/api/bosses');
  });
});
