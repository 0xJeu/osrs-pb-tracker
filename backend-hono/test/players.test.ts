import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app';
import { insertTestPlayerWithPb, truncateAll } from './helpers';

describe('GET /api/players/:name', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('returns 404 for an unknown player', async () => {
    const res = await app.request('/api/players/Nobody');
    expect(res.status).toBe(404);
  });

  it('returns a single player with their PBs', async () => {
    await insertTestPlayerWithPb({ boss: 'zulrah', timeSeconds: 80, displayName: 'Blitzen' });
    const res = await app.request('/api/players/blitzen');
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.displayName).toBe('Blitzen');
    expect(json.pbs).toEqual([{ boss: 'zulrah', timeSeconds: 80, updatedAt: expect.any(String) }]);
  });

  it('returns an ambiguous match list when two players share a name', async () => {
    await insertTestPlayerWithPb({
      boss: 'zulrah',
      timeSeconds: 80,
      displayName: 'Blitzen',
      accountHash: 'a',
    });
    await insertTestPlayerWithPb({
      boss: 'vorkath',
      timeSeconds: 143,
      displayName: 'Blitzen',
      accountHash: 'b',
    });

    const res = await app.request('/api/players/blitzen');
    const json = await res.json();
    expect(json.ambiguous).toBe(true);
    expect(json.matches).toHaveLength(2);
  });
});

describe('GET /api/players/by-id/:id', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('returns 404 for an unknown id', async () => {
    const res = await app.request('/api/players/by-id/999999');
    expect(res.status).toBe(404);
  });

  it('returns the player matching that id', async () => {
    const player = await insertTestPlayerWithPb({
      boss: 'zulrah',
      timeSeconds: 80,
      displayName: 'Blitzen',
    });
    const res = await app.request(`/api/players/by-id/${player.id}`);
    expect(res.status).toBe(200);
    expect((await res.json()).displayName).toBe('Blitzen');
  });
});
