import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app.js';
import { db } from '../src/db/client.js';
import { personalBests } from '../src/db/schema.js';
import { insertTestPlayerWithPb, truncateAll } from './helpers.js';

describe('GET /api/recent-syncs', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('returns an empty array when nothing is synced', async () => {
    const res = await app.request('/api/recent-syncs');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it('returns players ordered by most recent sync time', async () => {
    const older = await insertTestPlayerWithPb({
      boss: 'zulrah',
      timeSeconds: 80,
      displayName: 'Older Sync',
      updatedAt: new Date('2026-07-04T12:00:00.000Z'),
    });
    const newer = await insertTestPlayerWithPb({
      boss: 'vorkath',
      timeSeconds: 94,
      displayName: 'Newer Sync',
      updatedAt: new Date('2026-07-05T12:00:00.000Z'),
    });

    await db.insert(personalBests).values({
      playerId: newer.id,
      boss: 'phantom muspah',
      timeSeconds: 110,
      updatedAt: new Date('2026-07-05T12:01:00.000Z'),
    });

    const res = await app.request('/api/recent-syncs');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([
      {
        id: newer.id,
        displayName: 'Newer Sync',
        updatedAt: '2026-07-05T12:00:00.000Z',
        pbCount: 2,
      },
      {
        id: older.id,
        displayName: 'Older Sync',
        updatedAt: '2026-07-04T12:00:00.000Z',
        pbCount: 1,
      },
    ]);
  });

  it('honors a positive limit query parameter', async () => {
    await insertTestPlayerWithPb({
      boss: 'zulrah',
      timeSeconds: 80,
      displayName: 'Older Sync',
      updatedAt: new Date('2026-07-04T12:00:00.000Z'),
    });
    const newer = await insertTestPlayerWithPb({
      boss: 'vorkath',
      timeSeconds: 94,
      displayName: 'Newer Sync',
      updatedAt: new Date('2026-07-05T12:00:00.000Z'),
    });

    const res = await app.request('/api/recent-syncs?limit=1');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([
      {
        id: newer.id,
        displayName: 'Newer Sync',
        updatedAt: '2026-07-05T12:00:00.000Z',
        pbCount: 1,
      },
    ]);
  });
});
