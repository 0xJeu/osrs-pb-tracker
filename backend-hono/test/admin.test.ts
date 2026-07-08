import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app.js';
import { resetRateLimiter } from '../src/lib/secret.js';
import { insertTestAdmin, insertTestPlayer, insertTestPlayerWithPb, truncateAll } from './helpers.js';

function basicAuthHeader(username: string, password: string) {
  return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
}

describe('/api/admin', () => {
  beforeEach(async () => {
    await truncateAll();
    resetRateLimiter();
    await insertTestAdmin('steph', 'correct horse battery staple');
  });

  describe('auth', () => {
    it('rejects a request with no credentials', async () => {
      const res = await app.request('/api/admin/players');
      expect(res.status).toBe(401);
      expect(res.headers.get('WWW-Authenticate')).toMatch(/Basic/);
    });

    it('rejects a request with the wrong password', async () => {
      const res = await app.request('/api/admin/players', {
        headers: { Authorization: basicAuthHeader('steph', 'wrong password') },
      });
      expect(res.status).toBe(401);
    });

    it('rejects a request for an unknown username', async () => {
      const res = await app.request('/api/admin/players', {
        headers: { Authorization: basicAuthHeader('nobody', 'whatever') },
      });
      expect(res.status).toBe(401);
    });

    it('accepts a request with correct credentials', async () => {
      const res = await app.request('/api/admin/players', {
        headers: { Authorization: basicAuthHeader('steph', 'correct horse battery staple') },
      });
      expect(res.status).toBe(200);
    });
  });

  describe('GET /players', () => {
    it('returns one row per player with first sync, last sync, and PB count', async () => {
      await insertTestPlayerWithPb({ boss: 'zulrah', timeSeconds: 80, displayName: 'Blitzen' });
      await insertTestPlayerWithPb({ boss: 'vorkath', timeSeconds: 90, displayName: 'Cham' });
      await insertTestPlayer({ displayName: 'NoPbsYet' });

      const res = await app.request('/api/admin/players', {
        headers: { Authorization: basicAuthHeader('steph', 'correct horse battery staple') },
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json).toHaveLength(3);
      expect(json[0]).toMatchObject({ displayName: expect.any(String), pbCount: expect.any(Number) });
      expect(json[0]).toHaveProperty('createdAt');
      expect(json[0]).toHaveProperty('lastSyncedAt');

      const noPbsRow = json.find((row: { displayName: string }) => row.displayName === 'NoPbsYet');
      expect(noPbsRow).toMatchObject({ pbCount: 0 });
    });

    it('returns an empty list when there are no players', async () => {
      const res = await app.request('/api/admin/players', {
        headers: { Authorization: basicAuthHeader('steph', 'correct horse battery staple') },
      });
      expect(await res.json()).toEqual([]);
    });
  });

  describe('GET /stats', () => {
    it('computes aggregate counters correctly', async () => {
      await insertTestPlayerWithPb({ boss: 'zulrah', timeSeconds: 80, displayName: 'Blitzen' });
      await insertTestPlayerWithPb({
        boss: 'vorkath',
        timeSeconds: 90,
        displayName: 'Cham',
        lastSyncedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
      });

      const res = await app.request('/api/admin/stats', {
        headers: { Authorization: basicAuthHeader('steph', 'correct horse battery staple') },
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        totalPlayers: 2,
        totalPbs: 2,
        playersSyncedLast24h: 1,
        playersInactive7d: 1,
      });
    });
  });
});
