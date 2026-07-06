import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app.js';
import { insertTestPlayerWithPb, truncateAll } from './helpers.js';

describe('GET /api/search', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('returns an empty array with no query', async () => {
    const res = await app.request('/api/search');
    expect(await res.json()).toEqual([]);
  });

  it('returns matching display names', async () => {
    await insertTestPlayerWithPb({ boss: 'zulrah', timeSeconds: 80, displayName: 'Blitzen' });
    const res = await app.request('/api/search?q=blit');
    expect(await res.json()).toEqual(['Blitzen']);
  });

  it('does not match unrelated names', async () => {
    await insertTestPlayerWithPb({ boss: 'zulrah', timeSeconds: 80, displayName: 'Blitzen' });
    const res = await app.request('/api/search?q=zzz');
    expect(await res.json()).toEqual([]);
  });
});
