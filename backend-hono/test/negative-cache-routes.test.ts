import { afterEach, describe, expect, it, vi } from 'vitest';
import { app } from '../src/app.js';
import { db } from '../src/db/client.js';
import { readCachedSyncDenial, readNegativeCache } from '../src/lib/negativeCache.js';

vi.mock('../src/lib/negativeCache.js', async (original) => ({
  ...await original<typeof import('../src/lib/negativeCache.js')>(),
  readCachedSyncDenial: vi.fn(async () => null),
  readNegativeCache: vi.fn(async () => null),
}));
afterEach(() => {
  vi.mocked(readCachedSyncDenial).mockReset().mockResolvedValue(null);
  vi.mocked(readNegativeCache).mockReset().mockResolvedValue(null);
  vi.restoreAllMocks();
});

function forbidDatabase() {
  const select = vi.spyOn(db, 'select').mockImplementation(() => { throw new Error('unexpected Neon select'); });
  const transaction = vi.spyOn(db.$client, 'transaction').mockImplementation(() => { throw new Error('unexpected Neon transaction'); });
  const insert = vi.spyOn(db, 'insert').mockImplementation(() => { throw new Error('unexpected Neon insert'); });
  return () => { expect(select).not.toHaveBeenCalled(); expect(transaction).not.toHaveBeenCalled(); expect(insert).not.toHaveBeenCalled(); };
}
describe('negative request fast paths', () => {
  it.each(['RECOVERY_PENDING', 'RECOVERY_CONTESTED', 'RECOVERY_REJECTED'])('serves %s with zero Neon calls', async (code) => {
    vi.mocked(readCachedSyncDenial).mockResolvedValue({
      error: 'Installation is not authorized', code, recoveryId: 12,
      retryAfterSeconds: 900, syncAttemptId: null,
    });
    const assertNoDatabase = forbidDatabase();
    const response = await app.request('/api/sync', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accountHash: 'negative-cache-account', displayName: 'Cache Test', installSecret: 'test-install-secret-12345', pbs: { zulrah: 90 } }) });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code, syncAttemptId: null });
    assertNoDatabase();
  });
  it.each(['/api/players/NoSuchCachedName', '/api/players/by-id/987654321'])('serves cached unknown %s with zero Neon calls', async (path) => {
    vi.mocked(readNegativeCache).mockResolvedValue(true);
    const assertNoDatabase = forbidDatabase();
    const response = await app.request(path);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Player not found' });
    assertNoDatabase();
  });
  it('rejects malformed sync before cache lookup', async () => {
    const assertNoDatabase = forbidDatabase();
    const response = await app.request('/api/sync', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(response.status).toBe(400);
    expect(readCachedSyncDenial).not.toHaveBeenCalled();
    assertNoDatabase();
  });
  it('falls through to Neon for an uncached missing name', async () => {
    const select = vi.spyOn(db, 'select');
    const response = await app.request('/api/players/UncachedNegativeTestName');
    expect(response.status).toBe(404);
    expect(select).toHaveBeenCalled();
  });
});
