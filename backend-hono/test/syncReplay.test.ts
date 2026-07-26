import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  expireTag: vi.fn(),
  get: vi.fn(),
  set: vi.fn(),
}));

vi.mock('@vercel/functions', () => ({
  getCache: () => ({
    get: mocks.get,
    set: mocks.set,
    expireTag: mocks.expireTag,
  }),
}));

describe('invalidatePlayerSyncReplay', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mocks.expireTag.mockReset();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('does not throw when the cache backend fails', async () => {
    mocks.expireTag.mockRejectedValueOnce(new Error('cache outage'));
    const { invalidatePlayerSyncReplay } = await import('../src/lib/syncReplay.js');

    // A caller like promoteInstallRecoveryCandidate runs this after its
    // database mutation has already committed - it must never surface a
    // cache-layer failure as if the mutation itself had failed.
    await expect(invalidatePlayerSyncReplay(42)).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      'Unable to invalidate PB sync replay cache for player',
      expect.objectContaining({ playerId: 42 })
    );
  });

  it('scopes the expired tag to just the given player', async () => {
    mocks.expireTag.mockResolvedValueOnce(undefined);
    const { invalidatePlayerSyncReplay } = await import('../src/lib/syncReplay.js');

    await invalidatePlayerSyncReplay(7);
    expect(mocks.expireTag).toHaveBeenCalledWith(expect.stringContaining('-player-7'));
  });
});
