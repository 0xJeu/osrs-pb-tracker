import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app.js';
import { insertTestPlayerWithPb, truncateAll } from './helpers.js';

describe('GET /api/bosses', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('returns an empty array when nothing is synced', async () => {
    const res = await app.request('/api/bosses');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it('returns distinct boss names sorted alphabetically', async () => {
    await insertTestPlayerWithPb({ boss: 'zulrah', timeSeconds: 80 });
    await insertTestPlayerWithPb({ boss: 'vorkath', timeSeconds: 143 });

    const res = await app.request('/api/bosses');
    expect(await res.json()).toEqual(['vorkath', 'zulrah']);
  });
});
