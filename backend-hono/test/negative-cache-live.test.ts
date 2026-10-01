import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Redis } from '@upstash/redis';
import { app } from '../src/app.js';
import { db } from '../src/db/client.js';
import { promoteInstallRecoveryCandidate, rejectInstallRecoveryCandidate, reopenRejectedInstallRecoveryCandidate } from '../src/lib/installRecovery.js';

// Opt-in only: setup.ts still verifies the destructive TEST Neon branch.
// The harness supplies explicit Redis credentials and a fresh scratch namespace.
describe.skipIf(process.env.NEGATIVE_CACHE_LIVE_TEST !== 'true')('live Redis negative-cache integration', () => {
  beforeAll(() => {
    if (!process.env.PUBLIC_READ_MODEL_NAMESPACE?.startsWith('negative-cache-test:')
      || process.env.PUBLIC_READ_MODEL_MODE !== 'disabled') throw new Error('Isolated Redis namespace and disabled public snapshot required');
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    const namespace = process.env.PUBLIC_READ_MODEL_NAMESPACE;
    if (!namespace?.startsWith('negative-cache-test:')) return;
    const redis = new Redis({ url: process.env.KV_REST_API_URL!, token: process.env.KV_REST_API_TOKEN! });
    const keys = await redis.keys(`${namespace}:*`);
    if (keys.length) await redis.del(...keys);
  });
  function sync(secret: string, name = 'Live Cache Fixture') {
    return app.request('/api/sync', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
      accountHash: 'negative-cache-live-fixture', displayName: name, installSecret: secret.repeat(20), pbs: { zulrah: 90 },
    }) });
  }
  function forbidNeon() {
    const spies = [vi.spyOn(db, 'select'), vi.spyOn(db, 'insert'), vi.spyOn(db.$client, 'transaction')];
    for (const spy of spies) spy.mockImplementation(() => { throw new Error('Unexpected Neon call on warm cache'); });
    return () => { for (const spy of spies) expect(spy).not.toHaveBeenCalled(); vi.restoreAllMocks(); };
  }
  it('serves warm denials without Neon and clears them on reject, reopen and promotion', async () => {
    expect((await sync('a')).status).toBe(200);
    const cold = await sync('b'); expect(cold.status).toBe(409);
    const body = await cold.json(); expect(body.code).toBe('RECOVERY_PENDING');
    let verify = forbidNeon(); const warm = await sync('b');
    expect(warm.status).toBe(409); expect(await warm.json()).toMatchObject({ code: 'RECOVERY_PENDING', syncAttemptId: null }); verify();
    await rejectInstallRecoveryCandidate(body.recoveryId, 'live-cache-test');
    const rejected = await sync('b'); expect(await rejected.json()).toMatchObject({ code: 'RECOVERY_REJECTED' });
    verify = forbidNeon(); expect((await sync('b')).status).toBe(409); verify();
    await reopenRejectedInstallRecoveryCandidate(body.recoveryId, 'live-cache-test', 'fixture reopen');
    expect(await (await sync('b')).json()).toMatchObject({ code: 'RECOVERY_PENDING' });
    await promoteInstallRecoveryCandidate(body.recoveryId, 'live-cache-test', 'fixture promotion');
    expect((await sync('b')).status).toBe(200);
  }, 30_000);
  it('serves repeated missing names without Neon and invalidates absence on creation', async () => {
    const path = '/api/players/LiveAbsentCacheFixture';
    expect((await app.request(path)).status).toBe(404);
    const verify = forbidNeon(); expect((await app.request(path)).status).toBe(404); verify();
    expect((await sync('a', 'LiveAbsentCacheFixture')).status).toBe(200);
    expect((await app.request(path)).status).toBe(200);
  }, 30_000);
});
