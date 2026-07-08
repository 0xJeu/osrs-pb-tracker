import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/app.js';
import { resetRateLimiter } from '../src/lib/secret.js';
import { truncateAll } from './helpers.js';

function syncRequest(body: unknown) {
  return app.request('/api/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/sync', () => {
  beforeEach(async () => {
    await truncateAll();
    resetRateLimiter();
  });

  it('rejects a missing accountHash', async () => {
    const res = await syncRequest({ displayName: 'Blitzen', installSecret: 'a'.repeat(20), pbs: {} });
    expect(res.status).toBe(400);
  });

  it('rejects a missing installSecret', async () => {
    const res = await syncRequest({ accountHash: '1', displayName: 'Blitzen', pbs: {} });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/installSecret/);
  });

  it('rejects an installSecret shorter than 16 characters', async () => {
    const res = await syncRequest({
      accountHash: '1',
      displayName: 'Blitzen',
      installSecret: 'short',
      pbs: {},
    });
    expect(res.status).toBe(400);
  });

  it('creates a new player on first sync', async () => {
    const res = await syncRequest({
      accountHash: 'acct-1',
      displayName: 'Blitzen',
      installSecret: 'a'.repeat(20),
      pbs: { Zulrah: 80 },
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ ok: true, received: 1, updated: 1 });

    const lookup = await app.request('/api/players/Blitzen');
    expect((await lookup.json()).pbs).toEqual([
      { boss: 'zulrah', timeSeconds: 80, updatedAt: expect.any(String), rank: 1 },
    ]);
  });

  it('silently drops bosses with no official Jagex personal best', async () => {
    const res = await syncRequest({
      accountHash: 'acct-1',
      displayName: 'Blitzen',
      installSecret: 'a'.repeat(20),
      pbs: { 'Dagannoth Prime': 60, Zulrah: 80 },
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ ok: true, received: 2, updated: 1 });

    const lookup = await app.request('/api/players/Blitzen');
    expect((await lookup.json()).pbs).toEqual([
      { boss: 'zulrah', timeSeconds: 80, updatedAt: expect.any(String), rank: 1 },
    ]);
  });

  it('silently drops bare "mode" keys that duplicate an Adventure Log-labeled variant', async () => {
    const res = await syncRequest({
      accountHash: 'acct-1',
      displayName: 'Blitzen',
      installSecret: 'a'.repeat(20),
      pbs: {
        'Theatre of Blood Hard Mode': 927,
        'Theatre of Blood Entry Mode': 956,
        'Chambers of Xeric Challenge Mode': 1462,
        'Tombs of Amascut Expert Mode': 923,
        'Tombs of Amascut Entry Mode': 800,
        Zulrah: 80,
      },
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ ok: true, received: 6, updated: 1 });

    const lookup = await app.request('/api/players/Blitzen');
    expect((await lookup.json()).pbs).toEqual([
      { boss: 'zulrah', timeSeconds: 80, updatedAt: expect.any(String), rank: 1 },
    ]);
  });

  it('only overwrites a PB when the new time is faster', async () => {
    const secret = 'a'.repeat(20);
    await syncRequest({ accountHash: 'acct-1', displayName: 'Blitzen', installSecret: secret, pbs: { Zulrah: 80 } });
    const worse = await syncRequest({
      accountHash: 'acct-1',
      displayName: 'Blitzen',
      installSecret: secret,
      pbs: { Zulrah: 90 },
    });
    expect((await worse.json()).updated).toBe(0);

    const better = await syncRequest({
      accountHash: 'acct-1',
      displayName: 'Blitzen',
      installSecret: secret,
      pbs: { Zulrah: 75 },
    });
    expect((await better.json()).updated).toBe(1);
  });

  it('does not move the "Recorded" timestamp on an equal or slower resync, only on a faster one', async () => {
    const secret = 'a'.repeat(20);
    await syncRequest({ accountHash: 'acct-1', displayName: 'Blitzen', installSecret: secret, pbs: { Zulrah: 80 } });
    const firstLookup = await app.request('/api/players/Blitzen');
    const firstUpdatedAt = (await firstLookup.json()).pbs[0].updatedAt;

    await syncRequest({ accountHash: 'acct-1', displayName: 'Blitzen', installSecret: secret, pbs: { Zulrah: 90 } });
    const afterWorseLookup = await app.request('/api/players/Blitzen');
    expect((await afterWorseLookup.json()).pbs[0].updatedAt).toBe(firstUpdatedAt);

    await syncRequest({ accountHash: 'acct-1', displayName: 'Blitzen', installSecret: secret, pbs: { Zulrah: 80 } });
    const afterEqualLookup = await app.request('/api/players/Blitzen');
    expect((await afterEqualLookup.json()).pbs[0].updatedAt).toBe(firstUpdatedAt);

    await syncRequest({ accountHash: 'acct-1', displayName: 'Blitzen', installSecret: secret, pbs: { Zulrah: 75 } });
    const afterFasterLookup = await app.request('/api/players/Blitzen');
    expect((await afterFasterLookup.json()).pbs[0].updatedAt).not.toBe(firstUpdatedAt);
  });

  it('rejects a resync with a different secret', async () => {
    await syncRequest({
      accountHash: 'acct-1',
      displayName: 'Blitzen',
      installSecret: 'a'.repeat(20),
      pbs: { Zulrah: 80 },
    });
    const res = await syncRequest({
      accountHash: 'acct-1',
      displayName: 'Blitzen',
      installSecret: 'b'.repeat(20),
      pbs: { Zulrah: 80 },
    });
    expect(res.status).toBe(409);
  });

  it('rate-limits after too many requests for the same account', async () => {
    const secret = 'a'.repeat(20);
    for (let i = 0; i < 30; i += 1) {
      await syncRequest({ accountHash: 'acct-1', displayName: 'Blitzen', installSecret: secret, pbs: {} });
    }
    const res = await syncRequest({ accountHash: 'acct-1', displayName: 'Blitzen', installSecret: secret, pbs: {} });
    expect(res.status).toBe(429);
  });
});
