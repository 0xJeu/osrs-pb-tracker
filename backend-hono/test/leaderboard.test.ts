import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app.js';
import { insertManyTestPlayersWithPbs, insertTestPlayerWithPb, truncateAll } from './helpers.js';

describe('GET /api/leaderboard/:boss', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('returns an empty array when nobody has synced that boss', async () => {
    const res = await app.request('/api/leaderboard/zulrah?limit=25');
    expect(res.headers.get('cache-control')).toBe('public, max-age=0, must-revalidate');
    expect(res.headers.get('cdn-cache-control')).toBe(
      'public, max-age=86400, stale-while-revalidate=604800'
    );
    expect(res.headers.get('vercel-cache-tag')).toBe('boss:zulrah');
    expect(await res.json()).toEqual([]);
  });

  it('sorts fastest time first', async () => {
    await insertTestPlayerWithPb({ boss: 'zulrah', timeSeconds: 100, displayName: 'Slow' });
    await insertTestPlayerWithPb({ boss: 'zulrah', timeSeconds: 80, displayName: 'Fast' });

    const res = await app.request('/api/leaderboard/zulrah?limit=25');
    const json = (await res.json()) as Array<{ displayName: string }>;
    expect(json.map((row) => row.displayName)).toEqual(['Fast', 'Slow']);
  });

  it('returns a cached empty result for an untracked boss', async () => {
    const res = await app.request('/api/leaderboard/not-a-real-boss?limit=25');
    expect(res.status).toBe(200);
    expect(res.headers.get('vercel-cache-tag')).toBe('boss:not-a-real-boss');
    expect(await res.json()).toEqual([]);
  });

  it('clamps limit to a maximum of 100', async () => {
    const res = await app.request('/api/leaderboard/zulrah?limit=99999');
    expect(res.status).toBe(200);
  });

  it('returns paginated rows with total and rank offset metadata', async () => {
    await insertManyTestPlayersWithPbs(Array.from({ length: 55 }, (_, i) => ({
        boss: 'zulrah',
        timeSeconds: 80 + i,
        displayName: `Player${i}`,
        accountHash: `paged-acct-${i}`,
    })));

    const res = await app.request('/api/leaderboard/zulrah?limit=25&offset=25');
    const json = await res.json();
    expect(res.headers.get('vercel-cache-tag')).toBe('boss:zulrah');
    expect(json).toMatchObject({ total: 55, limit: 25, offset: 25 });
    expect(json.rows).toHaveLength(25);
    expect(json.rows[0].displayName).toBe('Player25');
  });

  it('opens the page containing a highlighted player', async () => {
    await insertManyTestPlayersWithPbs(Array.from({ length: 55 }, (_, i) => ({
        boss: 'zulrah',
        timeSeconds: 80 + i,
        displayName: `Player${i}`,
        accountHash: `highlight-page-acct-${i}`,
    })));

    const res = await app.request('/api/leaderboard/zulrah?limit=25&offset=0&highlight=Player52');
    const json = await res.json();
    expect(json.offset).toBe(50);
    expect(json.rows.map((row: { displayName: string }) => row.displayName)).toContain('Player52');
  });

  it('extends past the default limit to include a highlighted player beyond it', async () => {
    for (let i = 0; i < 30; i++) {
      await insertTestPlayerWithPb({
        boss: 'zulrah',
        timeSeconds: 80 + i,
        displayName: `Player${i}`,
        accountHash: `acct-${i}`,
      });
    }
    // Player29 has the slowest time, so sits at rank 30 - past the default
    // limit of 25.
    const res = await app.request('/api/leaderboard/zulrah?limit=25&highlight=player29');
    const json = (await res.json()) as Array<{ displayName: string }>;
    expect(json).toHaveLength(30);
    expect(json[29].displayName).toBe('Player29');
  });

  it('is case-insensitive when matching the highlighted player', async () => {
    await insertTestPlayerWithPb({ boss: 'zulrah', timeSeconds: 80, displayName: 'Blitzen' });
    const res = await app.request('/api/leaderboard/Zulrah?limit=25&highlight=BLITZEN');
    const json = (await res.json()) as Array<{ displayName: string }>;
    expect(json.map((row) => row.displayName)).toEqual(['Blitzen']);
  });

  it('falls back to the plain limit when the highlighted player is not found', async () => {
    await insertTestPlayerWithPb({ boss: 'zulrah', timeSeconds: 80, displayName: 'Blitzen' });
    const res = await app.request('/api/leaderboard/zulrah?limit=25&highlight=nobody');
    const json = (await res.json()) as Array<{ displayName: string }>;
    expect(json.map((row) => row.displayName)).toEqual(['Blitzen']);
  });
});
