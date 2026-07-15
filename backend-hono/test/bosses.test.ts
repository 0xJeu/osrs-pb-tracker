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
    expect(res.headers.get('cache-control')).toBe('public, max-age=0, must-revalidate');
    expect(res.headers.get('cdn-cache-control')).toBe(
      'public, max-age=86400, stale-while-revalidate=604800'
    );
    expect(res.headers.get('vercel-cache-tag')).toBe('boss-list');
    expect(await res.json()).toEqual([]);
  });

  it('redirects ignored query parameters before querying', async () => {
    const res = await app.request('/api/bosses?utm_source=test');
    expect(res.status).toBe(308);
    expect(res.headers.get('location')).toBe('/api/bosses');
  });

  it('returns distinct boss names sorted alphabetically', async () => {
    await insertTestPlayerWithPb({ boss: 'zulrah', timeSeconds: 80 });
    await insertTestPlayerWithPb({ boss: 'vorkath', timeSeconds: 143 });

    const res = await app.request('/api/bosses');
    expect(await res.json()).toEqual(['vorkath', 'zulrah']);
  });

  it('lists a boss only once even when multiple players have a PB for it', async () => {
    await insertTestPlayerWithPb({ boss: 'zulrah', timeSeconds: 80, displayName: 'PlayerA' });
    await insertTestPlayerWithPb({ boss: 'zulrah', timeSeconds: 95, displayName: 'PlayerB' });

    const res = await app.request('/api/bosses');
    expect(await res.json()).toEqual(['zulrah']);
  });
});
