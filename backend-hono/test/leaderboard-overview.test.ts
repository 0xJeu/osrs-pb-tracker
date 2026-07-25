import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app.js';
import { CURATED_OVERVIEW_BOSSES } from '../src/lib/curatedOverviewBosses.js';
import { insertTestPlayerWithPb, truncateAll } from './helpers.js';

describe('GET /api/leaderboard-overview', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('returns every curated boss with a null leader when nobody has synced', async () => {
    const res = await app.request('/api/leaderboard-overview');
    expect(res.status).toBe(200);
    const json = (await res.json()) as Array<{ boss: string; leader: unknown }>;
    expect(json.map((row) => row.boss)).toEqual([...CURATED_OVERVIEW_BOSSES]);
    expect(json.every((row) => row.leader === null)).toBe(true);
  });

  it('returns the fastest synced time per curated boss and preserves list order', async () => {
    await insertTestPlayerWithPb({ boss: 'zulrah', timeSeconds: 100, displayName: 'Slow' });
    await insertTestPlayerWithPb({ boss: 'zulrah', timeSeconds: 80, displayName: 'Fast' });
    await insertTestPlayerWithPb({ boss: 'vorkath', timeSeconds: 45, displayName: 'OnlyVorkath' });

    const res = await app.request('/api/leaderboard-overview');
    const json = (await res.json()) as Array<{ boss: string; leader: { displayName: string; timeSeconds: number } | null }>;
    const zulrah = json.find((row) => row.boss === 'zulrah');
    const vorkath = json.find((row) => row.boss === 'vorkath');
    const whisperer = json.find((row) => row.boss === 'the whisperer');

    expect(zulrah?.leader).toMatchObject({ displayName: 'Fast', timeSeconds: 80 });
    expect(vorkath?.leader).toMatchObject({ displayName: 'OnlyVorkath', timeSeconds: 45 });
    expect(whisperer?.leader).toBeNull();
    expect(json.map((row) => row.boss)).toEqual([...CURATED_OVERVIEW_BOSSES]);
  });

  it('breaks a tied fastest time deterministically by display name', async () => {
    await insertTestPlayerWithPb({ boss: 'vorkath', timeSeconds: 60, displayName: 'Zed', accountHash: 'tie-1' });
    await insertTestPlayerWithPb({ boss: 'vorkath', timeSeconds: 60, displayName: 'Abe', accountHash: 'tie-2' });

    const res = await app.request('/api/leaderboard-overview');
    const json = (await res.json()) as Array<{ boss: string; leader: { displayName: string } | null }>;
    expect(json.find((row) => row.boss === 'vorkath')?.leader?.displayName).toBe('Abe');
  });

  it('ignores non-curated bosses entirely', async () => {
    await insertTestPlayerWithPb({ boss: 'nex', timeSeconds: 10, displayName: 'NexPlayer' });

    const res = await app.request('/api/leaderboard-overview');
    const json = (await res.json()) as Array<{ boss: string }>;
    expect(json.map((row) => row.boss)).not.toContain('nex');
  });

  it('sets shared-cache headers and one cache tag per curated boss', async () => {
    const res = await app.request('/api/leaderboard-overview');
    expect(res.headers.get('cache-control')).toBe('public, max-age=0, must-revalidate');
    expect(res.headers.get('cdn-cache-control')).toBe(
      'public, max-age=86400, stale-while-revalidate=604800'
    );
    const tags = res.headers.get('vercel-cache-tag')?.split(',') ?? [];
    for (const boss of CURATED_OVERVIEW_BOSSES) {
      expect(tags).toContain(`boss:${encodeURIComponent(boss)}`);
    }
  });

  it('does not accept a caller-supplied boss list', async () => {
    const res = await app.request('/api/leaderboard-overview?bosses=nex,zulrah');
    const json = (await res.json()) as Array<{ boss: string }>;
    expect(json.map((row) => row.boss)).toEqual([...CURATED_OVERVIEW_BOSSES]);
  });
});
