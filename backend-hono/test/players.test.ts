import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app.js';
import { insertTestPlayerWithPb, truncateAll } from './helpers.js';

describe('GET /api/players/:name', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('returns 404 for an unknown player', async () => {
    const res = await app.request('/api/players/Nobody?ignored=true');
    expect(res.status).toBe(404);
    expect(res.headers.get('cdn-cache-control')).toBe(
      'public, max-age=3600, stale-while-revalidate=86400'
    );
    expect(res.headers.get('vercel-cache-tag')).toBe('player-name:nobody');
  });

  it('returns a single player with their PBs', async () => {
    await insertTestPlayerWithPb({ boss: 'zulrah', timeSeconds: 80, displayName: 'Blitzen' });
    const res = await app.request('/api/players/blitzen');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('public, max-age=0, must-revalidate');
    expect(res.headers.get('cdn-cache-control')).toBe(
      'public, max-age=86400, stale-while-revalidate=604800'
    );
    expect(res.headers.get('vercel-cache-tag')).toContain('player-name:blitzen');
    expect(res.headers.get('vercel-cache-tag')).toContain('player-id:');
    expect(res.headers.get('vercel-cache-tag')).toContain('profile-boss-bucket:');
    const json = await res.json();
    expect(json.displayName).toBe('Blitzen');
    expect(json.pbs).toEqual([{ boss: 'zulrah', timeSeconds: 80, updatedAt: expect.any(String), rank: 1 }]);
  });

  it("includes each PB's rank on the boss leaderboard", async () => {
    await insertTestPlayerWithPb({ boss: 'zulrah', timeSeconds: 90, displayName: 'Slower', accountHash: 'a' });
    await insertTestPlayerWithPb({ boss: 'zulrah', timeSeconds: 80, displayName: 'Middle', accountHash: 'b' });
    await insertTestPlayerWithPb({ boss: 'zulrah', timeSeconds: 70, displayName: 'Fastest', accountHash: 'c' });

    const middle = await app.request('/api/players/middle');
    expect((await middle.json()).pbs).toEqual([
      { boss: 'zulrah', timeSeconds: 80, updatedAt: expect.any(String), rank: 2 },
    ]);

    const fastest = await app.request('/api/players/fastest');
    expect((await fastest.json()).pbs).toEqual([
      { boss: 'zulrah', timeSeconds: 70, updatedAt: expect.any(String), rank: 1 },
    ]);

    const slower = await app.request('/api/players/slower');
    expect((await slower.json()).pbs).toEqual([
      { boss: 'zulrah', timeSeconds: 90, updatedAt: expect.any(String), rank: 3 },
    ]);
  });

  it('returns an ambiguous match list when two players share a name', async () => {
    await insertTestPlayerWithPb({
      boss: 'zulrah',
      timeSeconds: 80,
      displayName: 'Blitzen',
      accountHash: 'a',
    });
    await insertTestPlayerWithPb({
      boss: 'vorkath',
      timeSeconds: 143,
      displayName: 'Blitzen',
      accountHash: 'b',
    });

    const res = await app.request('/api/players/blitzen');
    const json = await res.json();
    expect(json.ambiguous).toBe(true);
    expect(json.matches).toHaveLength(2);
  });
});

describe('GET /api/players/by-id/:id', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('returns 404 for an unknown id', async () => {
    const res = await app.request('/api/players/by-id/999999');
    expect(res.status).toBe(404);
    expect(res.headers.get('cdn-cache-control')).toBe(
      'public, max-age=3600, stale-while-revalidate=86400'
    );
    expect(res.headers.get('vercel-cache-tag')).toBe('player-id:999999');
  });

  it('returns the player matching that id', async () => {
    const player = await insertTestPlayerWithPb({
      boss: 'zulrah',
      timeSeconds: 80,
      displayName: 'Blitzen',
    });
    const res = await app.request(`/api/players/by-id/${player.id}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cdn-cache-control')).toBe(
      'public, max-age=86400, stale-while-revalidate=604800'
    );
    expect(res.headers.get('vercel-cache-tag')).toContain(`player-id:${player.id}`);
    expect((await res.json()).displayName).toBe('Blitzen');
  });

  it('normalizes numeric ids without redirecting', async () => {
    const res = await app.request('/api/players/by-id/00042?ignored=true');
    expect(res.status).toBe(404);
    expect(res.headers.get('vercel-cache-tag')).toBe('player-id:42');
  });

  it('caches invalid ids without querying', async () => {
    const res = await app.request('/api/players/by-id/not-a-number');
    expect(res.status).toBe(404);
    expect(res.headers.get('cdn-cache-control')).toBe(
      'public, max-age=3600, stale-while-revalidate=86400'
    );
  });
});
