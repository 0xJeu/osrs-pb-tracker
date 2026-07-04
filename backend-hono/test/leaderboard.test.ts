import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app.js';
import { insertTestPlayerWithPb, truncateAll } from './helpers.js';

describe('GET /api/leaderboard/:boss', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('returns an empty array when nobody has synced that boss', async () => {
    const res = await app.request('/api/leaderboard/zulrah');
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
});
