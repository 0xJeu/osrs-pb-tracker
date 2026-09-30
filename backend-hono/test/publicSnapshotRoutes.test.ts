import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublicSnapshotV1 } from '../src/lib/public-read-model/schema.js';

const readPrimaryPublicSnapshot = vi.fn<() => Promise<PublicSnapshotV1 | null>>();
const schedulePublicSnapshotRepair = vi.fn();

vi.mock('../src/lib/public-read-model/service.js', () => ({
  readPrimaryPublicSnapshot,
  schedulePublicSnapshotRepair,
}));

const { app } = await import('../src/app.js');

const snapshot: PublicSnapshotV1 = {
  schemaVersion: 1,
  revision: '9',
  generatedAt: '2026-09-29T00:00:00.000Z',
  sourceCounts: { players: 1, nameHistory: 1, personalBests: 1, bosses: 1 },
  bosses: ['zulrah'],
  playerIdsByLookupName: { blitzen: [42], 'old blitzen': [42] },
  profilesByPlayerId: {
    '42': {
      id: 42,
      displayName: 'Blitzen',
      updatedAt: '2026-09-29T00:00:00.000Z',
      pbs: [{
        boss: 'zulrah',
        timeSeconds: 80,
        updatedAt: '2026-09-29T00:00:00.000Z',
        rank: 1,
      }],
    },
  },
};

beforeEach(() => {
  readPrimaryPublicSnapshot.mockResolvedValue(snapshot);
  schedulePublicSnapshotRepair.mockReset();
});

describe('public snapshot routes', () => {
  it('serves player name and historic-name lookups without database fixtures', async () => {
    for (const name of ['blitzen', 'old%20blitzen']) {
      const response = await app.request(`/api/players/${name}`);
      expect(response.status).toBe(200);
      expect((await response.json()).id).toBe(42);
    }
    expect(schedulePublicSnapshotRepair).not.toHaveBeenCalled();
  });

  it('serves by-id and boss-list lookups without database fixtures', async () => {
    const profile = await app.request('/api/players/by-id/42');
    expect(profile.status).toBe(200);
    expect((await profile.json()).displayName).toBe('Blitzen');

    const bosses = await app.request('/api/bosses');
    expect(bosses.status).toBe(200);
    expect(await bosses.json()).toEqual(['zulrah']);
    expect(schedulePublicSnapshotRepair).not.toHaveBeenCalled();
  });

  it('falls back without rebuilding for a genuinely unknown name', async () => {
    const response = await app.request('/api/players/new-player');
    expect(response.status).toBe(404);
    expect(schedulePublicSnapshotRepair).not.toHaveBeenCalled();
  });

  it('schedules a repair when the complete snapshot is unavailable', async () => {
    readPrimaryPublicSnapshot.mockResolvedValueOnce(null);
    const response = await app.request('/api/players/new-player');
    expect(response.status).toBe(404);
    expect(schedulePublicSnapshotRepair).toHaveBeenCalledTimes(1);
  });
});
