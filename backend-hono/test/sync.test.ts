import { beforeEach, describe, expect, it, vi } from 'vitest';
import { asc, eq } from 'drizzle-orm';
import { app } from '../src/app.js';
import { db } from '../src/db/client.js';
import { syncAttempts } from '../src/db/schema.js';
import { resetRateLimiter } from '../src/lib/secret.js';
import { pruneExpiredSyncAttempts } from '../src/routes/sync.js';
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
    expect(res.headers.get('cdn-cache-control')).toBeNull();
    const json = await res.json();
    expect(json).toMatchObject({ ok: true, received: 1, updated: 1 });

    const lookup = await app.request('/api/players/blitzen');
    expect((await lookup.json()).pbs).toEqual([
      { boss: 'zulrah', timeSeconds: 80, updatedAt: expect.any(String), rank: 1 },
    ]);

    const [attempt] = await db.select().from(syncAttempts);
    expect(attempt).toMatchObject({
      playerId: json.playerId,
      outcome: 'accepted',
      httpStatus: 200,
      receivedCount: 1,
      eligibleCount: 1,
      updatedCount: 1,
    });
    expect(json.syncAttemptId).toBe(attempt.id);
  });

  it('keeps an old display name searchable after an authorized name change', async () => {
    const secret = 'a'.repeat(20);
    await syncRequest({ accountHash: 'rename-acct', displayName: 'Old Name', installSecret: secret, pbs: { Zulrah: 80 } });
    await syncRequest({ accountHash: 'rename-acct', displayName: 'New Name', installSecret: secret, pbs: { Zulrah: 79 } });

    const oldLookup = await app.request('/api/players/Old%20Name');
    expect(oldLookup.status).toBe(200);
    expect((await oldLookup.json()).displayName).toBe('New Name');

    const search = await app.request('/api/search/all?q=old');
    expect(await search.json()).toContainEqual({ type: 'player', value: 'New Name' });
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

    const lookup = await app.request('/api/players/blitzen');
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

    const lookup = await app.request('/api/players/blitzen');
    expect((await lookup.json()).pbs).toEqual([
      { boss: 'zulrah', timeSeconds: 80, updatedAt: expect.any(String), rank: 1 },
    ]);
  });

  it('silently drops bare "nightmare <team size>" keys that duplicate an Adventure Log-labeled variant', async () => {
    const res = await syncRequest({
      accountHash: 'acct-1',
      displayName: 'Blitzen',
      installSecret: 'a'.repeat(20),
      pbs: {
        'Nightmare 6+ Players': 238,
        'Nightmare Solo': 900,
        'Nightmare 3 Players': 400,
        Zulrah: 80,
      },
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ ok: true, received: 4, updated: 1 });

    const lookup = await app.request('/api/players/blitzen');
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

  it('upserts a bulk PB payload as one set and only reports changed rows', async () => {
    const secret = 'a'.repeat(20);
    const initialPbs = {
      Zulrah: 80,
      Vorkath: 70,
      Araxxor: 90,
      'Phantom Muspah': 110,
      'Corrupted Gauntlet': 420,
    };

    const initial = await syncRequest({
      accountHash: 'bulk-account',
      displayName: 'Bulk Sync',
      installSecret: secret,
      pbs: initialPbs,
    });
    expect(initial.status).toBe(200);
    expect((await initial.json()).updated).toBe(5);

    const unchanged = await syncRequest({
      accountHash: 'bulk-account',
      displayName: 'Bulk Sync',
      installSecret: secret,
      pbs: initialPbs,
    });
    expect(unchanged.status).toBe(200);
    expect((await unchanged.json()).updated).toBe(0);

    const partiallyFaster = await syncRequest({
      accountHash: 'bulk-account',
      displayName: 'Bulk Sync',
      installSecret: secret,
      pbs: { ...initialPbs, Zulrah: 75, Vorkath: 75 },
    });
    expect(partiallyFaster.status).toBe(200);
    expect((await partiallyFaster.json()).updated).toBe(1);
  });

  it('deduplicates raw keys that normalize to the same boss and keeps the fastest time', async () => {
    const res = await syncRequest({
      accountHash: 'duplicate-account',
      displayName: 'Duplicate Sync',
      installSecret: 'a'.repeat(20),
      pbs: { Zulrah: 80, ' zulrah ': 75, ZULRAH: 85 },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ received: 3, updated: 1 });

    const lookup = await app.request('/api/players/duplicate%20sync');
    expect((await lookup.json()).pbs).toEqual([
      { boss: 'zulrah', timeSeconds: 75, updatedAt: expect.any(String), rank: 1 },
    ]);
  });

  it('does not move the "Recorded" timestamp on an equal or slower resync, only on a faster one', async () => {
    const secret = 'a'.repeat(20);
    await syncRequest({ accountHash: 'acct-1', displayName: 'Blitzen', installSecret: secret, pbs: { Zulrah: 80 } });
    const firstLookup = await app.request('/api/players/blitzen');
    const firstUpdatedAt = (await firstLookup.json()).pbs[0].updatedAt;

    await syncRequest({ accountHash: 'acct-1', displayName: 'Blitzen', installSecret: secret, pbs: { Zulrah: 90 } });
    const afterWorseLookup = await app.request('/api/players/blitzen');
    expect((await afterWorseLookup.json()).pbs[0].updatedAt).toBe(firstUpdatedAt);

    await syncRequest({ accountHash: 'acct-1', displayName: 'Blitzen', installSecret: secret, pbs: { Zulrah: 80 } });
    const afterEqualLookup = await app.request('/api/players/blitzen');
    expect((await afterEqualLookup.json()).pbs[0].updatedAt).toBe(firstUpdatedAt);

    await syncRequest({ accountHash: 'acct-1', displayName: 'Blitzen', installSecret: secret, pbs: { Zulrah: 75 } });
    const afterFasterLookup = await app.request('/api/players/blitzen');
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
    const json = await res.json();
    const attempts = await db.select().from(syncAttempts).orderBy(asc(syncAttempts.id));
    expect(attempts).toHaveLength(2);
    expect(attempts[1]).toMatchObject({
      outcome: 'install_secret_mismatch',
      httpStatus: 409,
      receivedCount: 1,
      eligibleCount: 1,
      updatedCount: null,
    });
    expect(json).toMatchObject({
      code: 'RECOVERY_PENDING',
      recoveryId: attempts[1].recoveryCandidateId,
    });
    expect(json.syncAttemptId).toBe(attempts[1].id);
  });

  it('rate-limits after too many requests for the same account', async () => {
    const secret = 'a'.repeat(20);
    for (let i = 0; i < 30; i += 1) {
      await syncRequest({ accountHash: 'acct-1', displayName: 'Blitzen', installSecret: secret, pbs: {} });
    }
    const res = await syncRequest({ accountHash: 'acct-1', displayName: 'Blitzen', installSecret: secret, pbs: {} });
    expect(res.status).toBe(429);
    const json = await res.json();
    const attempts = await db.select().from(syncAttempts).orderBy(asc(syncAttempts.id));
    expect(attempts).toHaveLength(31);
    expect(attempts[30]).toMatchObject({
      outcome: 'rate_limited',
      httpStatus: 429,
      receivedCount: 0,
      eligibleCount: null,
      updatedCount: null,
    });
    expect(json.syncAttemptId).toBe(attempts[30].id);

    const selectSpy = vi.spyOn(db, 'select').mockImplementationOnce(() => {
      throw new Error('simulated audit lookup outage');
    });
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const unavailableAudit = await syncRequest({
      accountHash: 'acct-1',
      displayName: 'Blitzen',
      installSecret: secret,
      pbs: {},
    });
    expect(unavailableAudit.status).toBe(429);
    expect(await unavailableAudit.json()).toMatchObject({ syncAttemptId: null });
    expect(consoleSpy).toHaveBeenCalledWith(
      'Failed to identify rate-limited sync player',
      expect.objectContaining({ error: 'simulated audit lookup outage' })
    );
    selectSpy.mockRestore();
    consoleSpy.mockRestore();
  }, 15_000);

  it('opportunistically removes sync attempts older than 90 days', async () => {
    const res = await syncRequest({
      accountHash: 'retention-account',
      displayName: 'Retention Test',
      installSecret: 'a'.repeat(20),
      pbs: { Zulrah: 80 },
    });
    const { syncAttemptId } = await res.json();

    await db
      .update(syncAttempts)
      .set({ createdAt: new Date(Date.now() - 91 * 24 * 60 * 60 * 1000) })
      .where(eq(syncAttempts.id, syncAttemptId));

    await pruneExpiredSyncAttempts(100);

    const remaining = await db.select().from(syncAttempts);
    expect(remaining).toEqual([]);
  });
});
