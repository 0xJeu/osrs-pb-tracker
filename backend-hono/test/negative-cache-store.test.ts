import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const fake = vi.hoisted(() => ({ eval: vi.fn(), set: vi.fn() }));
vi.mock('@upstash/redis', () => ({ Redis: class { eval = fake.eval; set = fake.set; } }));
import {
  beginNegativeCacheFill, invalidateNegativeCache, missingPlayerFingerprint,
  publishNegativeCache, readCachedSyncDenial, readNegativeCache,
  resetNegativeCacheForTests, withDenialCacheInvalidation,
} from '../src/lib/negativeCache.js';

beforeEach(() => {
  vi.stubEnv('SYNC_DENIAL_CACHE_ENABLED', 'true');
  vi.stubEnv('PUBLIC_NEGATIVE_CACHE_ENABLED', 'true');
  vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://test.invalid');
  vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'test-placeholder');
  vi.stubEnv('PUBLIC_READ_MODEL_NAMESPACE', 'pbt:test:negative');
  fake.eval.mockReset(); fake.set.mockReset(); resetNegativeCacheForTests();
});
afterEach(() => { vi.unstubAllEnvs(); resetNegativeCacheForTests(); });
describe('negative cache trust boundaries', () => {
  it('does not touch Redis with flags off', async () => {
    vi.stubEnv('SYNC_DENIAL_CACHE_ENABLED', 'false');
    expect(await readCachedSyncDenial('fingerprint')).toBeNull();
    expect(await beginNegativeCacheFill('sync-denial')).toBeNull();
    expect(fake.eval).not.toHaveBeenCalled();
  });
  it.each(['not-json', JSON.stringify({version:1,generation:'g',expiresAt:0,value:true}),
    JSON.stringify({version:2,generation:'g',expiresAt:Date.now()+10000,value:true})])('rejects malformed or expired cache data', async (raw) => {
    fake.eval.mockResolvedValue(raw);
    expect(await readNegativeCache('player-missing', 'fingerprint')).toBeNull();
  });
  it('cannot turn a forged active record into authorization', async () => {
    fake.eval.mockResolvedValue(JSON.stringify({ version:1, generation:'g', expiresAt:Date.now()+10000,
      value:{error:'x', code:'ACTIVE', recoveryId:null, retryAfterSeconds:null, syncAttemptId:null} }));
    expect(await readCachedSyncDenial('fingerprint')).toBeNull();
  });
  it('falls back on Redis failure and never publishes without a fill generation', async () => {
    fake.eval.mockRejectedValue(new Error('provider unavailable'));
    expect(await readNegativeCache('player-missing', 'fingerprint')).toBeNull();
    expect(await beginNegativeCacheFill('player-missing')).toBeNull();
    fake.eval.mockClear();
    await publishNegativeCache('player-missing', 'fingerprint', null, true);
    expect(fake.eval).not.toHaveBeenCalled();
  });
  it('rotates before and after successful and failed operator decisions', async () => {
    const order: string[] = [];
    fake.set.mockImplementation(async () => { order.push('rotate'); return 'OK'; });
    await withDenialCacheInvalidation(async () => { order.push('commit'); return 1; });
    expect(order).toEqual(['rotate','commit','rotate']);
    order.length=0;
    await expect(withDenialCacheInvalidation(async () => { order.push('rollback'); throw new Error('conflict'); })).rejects.toThrow('conflict');
    expect(order).toEqual(['rotate','rollback','rotate']);
  });
  it('uses opaque, domain-separated player keys and fenced bounded fills', async () => {
    const fingerprint=missingPlayerFingerprint('name','example');
    expect(fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(fingerprint).not.toBe(missingPlayerFingerprint('id','example'));
    fake.eval.mockResolvedValue('generation');
    const generation=await beginNegativeCacheFill('player-missing');
    await publishNegativeCache('player-missing',fingerprint,generation,true);
    const args=fake.eval.mock.calls.at(-1)!;
    expect(args[2][0]).toBe('generation');
    expect(args[2][3]).toBe(300); expect(args[2][4]).toBe(2048);
    await invalidateNegativeCache('player-missing');
    expect(fake.set).toHaveBeenCalledOnce();
  });
});
