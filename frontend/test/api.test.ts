import { describe, expect, it, vi } from 'vitest';
import { createApiClient, resolveApiBaseUrl } from '../src/lib/api';

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
    expect(fetchFn).toHaveBeenCalledWith('/api/leaderboard/zulrah?limit=25&highlight=Blitzen');
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

describe('resolveApiBaseUrl', () => {
  it('honors an explicit configured base URL', () => {
    expect(resolveApiBaseUrl('https://api.example.test', { hostname: 'osrs-pb-tracker-frontend-git-demo.vercel.app' })).toBe(
      'https://api.example.test'
    );
  });

  it('falls back to same-origin paths outside frontend-only Vercel previews', () => {
    expect(resolveApiBaseUrl(undefined, { hostname: 'localhost' })).toBe('');
  });

  it('uses production API data for frontend Vercel previews without an env override', () => {
    expect(resolveApiBaseUrl(undefined, { hostname: 'osrs-pb-tracker-frontend-git-demo.vercel.app' })).toBe(
      'https://osrs-pb-tracker-backend.vercel.app'
    );
  });
});
