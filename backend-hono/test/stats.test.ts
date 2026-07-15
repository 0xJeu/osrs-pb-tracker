import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app.js';
import { db } from '../src/db/client.js';
import { personalBests } from '../src/db/schema.js';
import { insertTestPlayerWithPb, truncateAll } from './helpers.js';

describe('GET /api/stats', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('returns zero counts when nothing is synced', async () => {
    const res = await app.request('/api/stats');

    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('public, max-age=0, must-revalidate');
    expect(res.headers.get('cdn-cache-control')).toBe(
      'public, max-age=60, stale-while-revalidate=300'
    );
    expect(await res.json()).toEqual({
      trackedPlayers: 0,
      personalBestRecords: 0,
    });
  });

  it('returns tracked player and personal best record totals', async () => {
    const first = await insertTestPlayerWithPb({
      boss: 'zulrah',
      timeSeconds: 80,
      displayName: 'Blitzen',
    });
    await insertTestPlayerWithPb({
      boss: 'vorkath',
      timeSeconds: 94,
      displayName: 'Rune Friend',
    });
    await db.insert(personalBests).values({
      playerId: first.id,
      boss: 'phantom muspah',
      timeSeconds: 110,
      updatedAt: new Date('2026-07-05T12:01:00.000Z'),
    });

    const res = await app.request('/api/stats');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      trackedPlayers: 2,
      personalBestRecords: 3,
    });
  });
});
