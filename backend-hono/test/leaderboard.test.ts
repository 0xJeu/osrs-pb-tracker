import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app.js';
import { insertTestPlayerWithPb, truncateAll } from './helpers.js';

describe('GET /api/leaderboard/:boss', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('returns an empty array when nobody has synced that boss', async () => {
    const res = await app.request('/api/leaderboard/zulrah');
    expect(res.headers.get('cache-control')).toBe('public, max-age=0, must-revalidate');
    expect(res.headers.get('cdn-cache-control')).toBe(
      'public, max-age=30, stale-while-revalidate=60'
    );
    expect(await res.json()).toEqual([]);
  });

  it('sorts fastest time first', async () => {
    await insertTestPlayerWithPb({ boss: 'zulrah', timeSeconds: 100, displayName: 'Slow' });
    await insertTestPlayerWithPb({ boss: 'zulrah', timeSeconds: 80, displayName: 'Fast' });

    const res = await app.request('/api/leaderboard/zulrah');
    const json = (await res.json()) as Array<{ displayName: string }>;
    expect(json.map((row) => row.displayName)).toEqual(['Fast', 'Slow']);
  });

  it('clamps limit to a maximum of 100', async () => {
    const res = await app.request('/api/leaderboard/zulrah?limit=99999');
    expect(res.status).toBe(200);
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
    const res = await app.request('/api/leaderboard/zulrah?highlight=Player29');
    const json = (await res.json()) as Array<{ displayName: string }>;
    expect(json).toHaveLength(30);
    expect(json[29].displayName).toBe('Player29');
  });

  it('is case-insensitive when matching the highlighted player', async () => {
    await insertTestPlayerWithPb({ boss: 'zulrah', timeSeconds: 80, displayName: 'Blitzen' });
    const res = await app.request('/api/leaderboard/zulrah?highlight=BLITZEN');
    const json = (await res.json()) as Array<{ displayName: string }>;
    expect(json.map((row) => row.displayName)).toEqual(['Blitzen']);
  });

  it('falls back to the plain limit when the highlighted player is not found', async () => {
    await insertTestPlayerWithPb({ boss: 'zulrah', timeSeconds: 80, displayName: 'Blitzen' });
    const res = await app.request('/api/leaderboard/zulrah?highlight=Nobody');
    const json = (await res.json()) as Array<{ displayName: string }>;
    expect(json.map((row) => row.displayName)).toEqual(['Blitzen']);
  });
});
