import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app.js';
import { insertTestPlayerWithPb, truncateAll } from './helpers.js';

describe('GET /api/search', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('returns an empty array with no query', async () => {
    const res = await app.request('/api/search');
    expect(res.headers.get('cdn-cache-control')).toBe(
      'public, max-age=86400, stale-while-revalidate=604800'
    );
    expect(res.headers.get('vercel-cache-tag')).toBe('player-search');
    expect(await res.json()).toEqual([]);
  });

  it('does not query for one-character searches', async () => {
    await insertTestPlayerWithPb({ boss: 'zulrah', timeSeconds: 80, displayName: 'A Player' });
    const res = await app.request('/api/search?q=a');
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

  it('canonicalizes query casing and removes ignored parameters', async () => {
    const res = await app.request('/api/search?utm_source=test&q=BlIt');
    expect(res.status).toBe(308);
    expect(res.headers.get('location')).toBe('/api/search?q=blit');
  });
});
