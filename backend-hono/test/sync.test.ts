import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { asc, eq } from 'drizzle-orm';
import { app } from '../src/app.js';
import { db } from '../src/db/client.js';
import { players, syncAttempts } from '../src/db/schema.js';
import {
  bossCacheTag,
  cacheTags,
  playerIdCacheTag,
  profileBossBucketCacheTag,
  profileBossExactCacheTag,
} from '../src/lib/cache.js';
import { resetRateLimiter } from '../src/lib/secret.js';
import { resetSyncReplayCache } from '../src/lib/syncReplay.js';
import { pruneExpiredSyncAttempts, upsertPbs } from '../src/routes/sync.js';
import { truncateAll } from './helpers.js';

const mocks = vi.hoisted(() => ({
  invalidateByTag: vi.fn(),
}));

vi.mock('@vercel/functions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@vercel/functions')>();
  return {
    ...actual,
    invalidateByTag: mocks.invalidateByTag,
  };
});

function syncRequest(body: unknown) {
  return app.request('/api/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/sync', () => {
  beforeEach(async () => {
    await resetSyncReplayCache();
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

  it('short-circuits an identical successful payload before any database query or write', async () => {
    const body = {
      accountHash: 'replay-account',
      displayName: 'Replay Test',
      installSecret: 'a'.repeat(20),
      pbs: { Zulrah: 80, Vorkath: 70 },
    };
    const initial = await syncRequest(body);
    const initialJson = await initial.json();
    expect(initialJson).toMatchObject({ ok: true, updated: 2 });

    const selectSpy = vi.spyOn(db, 'select');
    const insertSpy = vi.spyOn(db, 'insert');
    const replay = await syncRequest({
      ...body,
      // Object order must not affect replay detection.
      pbs: { Vorkath: 70, Zulrah: 80 },
    });
    const replayJson = await replay.json();

    expect(replay.status).toBe(200);
    expect(replayJson).toMatchObject({
      ok: true,
      playerId: initialJson.playerId,
      received: 2,
      updated: 0,
      syncAttemptId: null,
      deduplicated: true,
    });
    expect(selectSpy).not.toHaveBeenCalled();
    expect(insertSpy).not.toHaveBeenCalled();
    selectSpy.mockRestore();
    insertSpy.mockRestore();

    const attempts = await db.select().from(syncAttempts);
    expect(attempts).toHaveLength(1);
  });

  it('does not audit an accepted no-op that reaches the database', async () => {
    const secret = 'a'.repeat(20);
    await syncRequest({
      accountHash: 'no-op-account',
      displayName: 'No-op Test',
      installSecret: secret,
      pbs: { Zulrah: 80 },
    });

    const noOp = await syncRequest({
      accountHash: 'no-op-account',
      displayName: 'No-op Test',
      installSecret: secret,
      pbs: { Zulrah: 90 },
    });

    expect(noOp.status).toBe(200);
    expect(await noOp.json()).toMatchObject({ updated: 0, syncAttemptId: null });
    const attempts = await db.select().from(syncAttempts);
    expect(attempts).toHaveLength(1);
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
      eligibleCount: null,
      updatedCount: null,
    });
    expect(json.syncAttemptId).toBe(attempts[1].id);
  });

  it('rate-limits after too many requests for the same account', async () => {
    const secret = 'a'.repeat(20);
    for (let i = 0; i < 30; i += 1) {
      await syncRequest({
        accountHash: 'acct-1',
        displayName: 'Blitzen',
        installSecret: secret,
        pbs: { [`unsupported-${i}`]: 1 },
      });
    }
    const res = await syncRequest({
      accountHash: 'acct-1',
      displayName: 'Blitzen',
      installSecret: secret,
      pbs: { 'unsupported-rate-limit': 1 },
    });
    expect(res.status).toBe(429);
    const json = await res.json();
    const attempts = await db.select().from(syncAttempts).orderBy(asc(syncAttempts.id));
    expect(attempts).toHaveLength(1);
    expect(json.syncAttemptId).toBeNull();

    const selectSpy = vi.spyOn(db, 'select');
    const shedWithoutDatabase = await syncRequest({
      accountHash: 'acct-1',
      displayName: 'Blitzen',
      installSecret: secret,
      pbs: { 'another-unsupported-rate-limit': 1 },
    });
    expect(shedWithoutDatabase.status).toBe(429);
    expect(await shedWithoutDatabase.json()).toMatchObject({ syncAttemptId: null });
    expect(selectSpy).not.toHaveBeenCalled();
    selectSpy.mockRestore();
  }, 15_000);

  // NOTE: `upsertPbs` classifies each changed boss as inserted (first PB ever
  // recorded for that boss) or improved (an existing PB beaten by a faster
  // time), using Postgres's `xmax = 0` trick. Only the classification itself
  // is this task's job - teaching the cache-invalidation logic in sync.ts's
  // route handler to actually treat the two cases differently (e.g. skipping
  // the `stats` tag on a mere improvement) is a later, separate task. Until
  // that lands, `invalidateByTag` still receives `stats` on both an insert
  // and an improvement, so we deliberately do not assert on invalidation
  // tags here - see the plan's Task 2.
  it('classifies a changed boss as inserted on first sync and improved on a faster resync', async () => {
    const [player] = await db
      .insert(players)
      .values({
        accountHash: 'upsert-pbs-probe',
        displayName: 'Upsert Probe',
        displayNameLower: 'upsert probe',
        installSecretHash: 'x',
        updatedAt: new Date(),
      })
      .returning({ id: players.id });
    const playerId = player.id;

    const inserted = await upsertPbs(playerId, new Map([['zulrah', 80]]));
    expect(inserted).toEqual({ insertedBosses: ['zulrah'], improvedBosses: [] });

    const improved = await upsertPbs(playerId, new Map([['zulrah', 75]]));
    expect(improved).toEqual({ insertedBosses: [], improvedBosses: ['zulrah'] });

    // An equal-or-slower resync changes nothing, so the boss is neither
    // inserted nor improved.
    const noOp = await upsertPbs(playerId, new Map([['zulrah', 90]]));
    expect(noOp).toEqual({ insertedBosses: [], improvedBosses: [] });
  });

  it('still reports the correct total `updated` count for a mixed insert+improve batch', async () => {
    const secret = 'a'.repeat(20);
    await syncRequest({
      accountHash: 'insert-vs-improve',
      displayName: 'Insert Vs Improve',
      installSecret: secret,
      pbs: { Zulrah: 80 },
    });

    const mixed = await syncRequest({
      accountHash: 'insert-vs-improve',
      displayName: 'Insert Vs Improve',
      installSecret: secret,
      // Vorkath is a brand-new boss (insert); Zulrah is a faster resync
      // (improvement). Both must still be counted in `updated`.
      pbs: { Zulrah: 75, Vorkath: 70 },
    });
    expect((await mixed.json()).updated).toBe(2);
  });

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

  describe('cache invalidation truth table', () => {
    const originalVercel = process.env.VERCEL;

    beforeEach(() => {
      process.env.VERCEL = '1';
      mocks.invalidateByTag.mockReset();
    });

    afterEach(() => {
      if (originalVercel === undefined) {
        delete process.env.VERCEL;
      } else {
        process.env.VERCEL = originalVercel;
      }
    });

    function invalidatedTags(): string[] {
      return mocks.invalidateByTag.mock.calls.flatMap((call) => call[0] as string[]);
    }

    it('invalidates bossList and search when a globally-new boss key is inserted', async () => {
      const secret = 'a'.repeat(20);
      // Establish the player on one boss first, so the later sync below is
      // neither a new-player creation nor a rename - isolating the
      // globally-new-boss logic under test from metadataChanged/created,
      // which would otherwise push search/stats on their own and let this
      // test pass even if the globally-new logic were deleted entirely.
      await syncRequest({
        accountHash: 'globally-new-account',
        displayName: 'Globally New',
        installSecret: secret,
        pbs: { Vorkath: 200 },
      });

      mocks.invalidateByTag.mockReset();

      // "Amoxliatl" has never appeared in personal_bests for any player in
      // the test database (truncateAll runs before each test), so this is a
      // genuinely globally-new boss key.
      const res = await syncRequest({
        accountHash: 'globally-new-account',
        displayName: 'Globally New',
        installSecret: secret,
        pbs: { Amoxliatl: 55 },
      });
      expect(res.status).toBe(200);
      expect((await res.json()).updated).toBe(1);

      const tags = invalidatedTags();
      expect(tags).toContain(cacheTags.bossList);
      expect(tags).toContain(cacheTags.search);
      expect(tags).toContain(cacheTags.stats);
    });

    it('does not invalidate bossList, search, or stats when only improving an existing (non-globally-new) boss', async () => {
      const secret = 'a'.repeat(20);
      // Seed another player with the same boss key first, so it is not
      // globally new by the time our subject player syncs it.
      await syncRequest({
        accountHash: 'seed-account',
        displayName: 'Seed Player',
        installSecret: secret,
        pbs: { Zulrah: 80 },
      });
      await syncRequest({
        accountHash: 'improve-account',
        displayName: 'Improve Player',
        installSecret: secret,
        pbs: { Zulrah: 80 },
      });

      mocks.invalidateByTag.mockReset();

      const improved = await syncRequest({
        accountHash: 'improve-account',
        displayName: 'Improve Player',
        installSecret: secret,
        pbs: { Zulrah: 70 },
      });
      expect(improved.status).toBe(200);
      const improvedJson = await improved.json();
      expect(improvedJson.updated).toBe(1);

      const tags = invalidatedTags();
      expect(tags).not.toContain(cacheTags.bossList);
      expect(tags).not.toContain(cacheTags.search);
      expect(tags).not.toContain(cacheTags.stats);
      // Positive half: an improvement must still invalidate the per-boss and
      // per-player tags, so a total-breakage bug (e.g. an empty tag array)
      // doesn't slip through by only ever checking for absence.
      expect(tags).toContain(bossCacheTag('zulrah'));
      expect(tags).toContain(playerIdCacheTag(improvedJson.playerId));
      // This is the cross-player rank-staleness case dual-tagging exists for:
      // another player's profile may be tagged either exact or bucket, and
      // an improvement from a DIFFERENT player must invalidate both so
      // neither scheme is left stale.
      expect(tags).toContain(profileBossExactCacheTag('zulrah'));
      expect(tags).toContain(profileBossBucketCacheTag('zulrah'));
    });

    it('invalidates stats but not bossList/search for a player-first-time (not globally-new) boss insertion', async () => {
      const secret = 'a'.repeat(20);
      // Seed another player with the boss key first, so it already exists
      // globally by the time our subject player inserts their own first PB
      // for it.
      await syncRequest({
        accountHash: 'seed-account-2',
        displayName: 'Seed Player Two',
        installSecret: secret,
        pbs: { Zulrah: 80 },
      });

      // Establish the subject player on an unrelated boss first, so their
      // later Zulrah sync is neither a new-player creation nor a rename -
      // isolating the "boss inserted but not globally new" case from the
      // unconditional search/stats invalidation those trigger.
      await syncRequest({
        accountHash: 'new-to-boss-account',
        displayName: 'New To Boss',
        installSecret: secret,
        pbs: { Vorkath: 200 },
      });

      mocks.invalidateByTag.mockReset();

      const inserted = await syncRequest({
        accountHash: 'new-to-boss-account',
        displayName: 'New To Boss',
        installSecret: secret,
        pbs: { Zulrah: 75 },
      });
      expect(inserted.status).toBe(200);
      const insertedJson = await inserted.json();
      expect(insertedJson.updated).toBe(1);

      const tags = invalidatedTags();
      expect(tags).toContain(cacheTags.stats);
      expect(tags).not.toContain(cacheTags.bossList);
      expect(tags).not.toContain(cacheTags.search);
      // Positive half: this insertion must still invalidate the per-boss and
      // per-player tags, so a total-breakage bug doesn't slip through by
      // only ever checking for absence.
      expect(tags).toContain(bossCacheTag('zulrah'));
      expect(tags).toContain(playerIdCacheTag(insertedJson.playerId));
    });

    it('invalidates both the exact and bucket profile tags for a changed boss', async () => {
      const secret = 'a'.repeat(20);
      const res = await syncRequest({
        accountHash: 'exact-and-bucket-account',
        displayName: 'Exact And Bucket',
        installSecret: secret,
        pbs: { Zulrah: 80 },
      });
      expect(res.status).toBe(200);
      expect((await res.json()).updated).toBe(1);

      const tags = invalidatedTags();
      expect(tags).toContain(profileBossExactCacheTag('zulrah'));
      expect(tags).toContain(profileBossBucketCacheTag('zulrah'));
    });
  });
});
