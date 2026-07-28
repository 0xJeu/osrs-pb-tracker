import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  bossCacheTag,
  cachePolicies,
  fitsExactProfileTags,
  invalidateSharedCache,
  playerNameCacheTag,
  profileBossBucketCacheTag,
  profileBossExactCacheTag,
  setSharedCache,
} from '../src/lib/cache.js';

const mocks = vi.hoisted(() => ({
  invalidateByTag: vi.fn(),
}));

vi.mock('@vercel/functions', () => ({
  invalidateByTag: mocks.invalidateByTag,
}));

describe('cache tags', () => {
  const originalVercel = process.env.VERCEL;

  beforeEach(() => {
    mocks.invalidateByTag.mockReset();
  });

  afterEach(() => {
    if (originalVercel === undefined) {
      delete process.env.VERCEL;
    } else {
      process.env.VERCEL = originalVercel;
    }
  });

  it('normalizes user-controlled tag values', () => {
    expect(bossCacheTag(' Zulrah ')).toBe('boss:zulrah');
    expect(playerNameCacheTag('Rune Friend')).toBe('player-name:rune%20friend');
  });

  it('hashes abnormal values so tags stay within Vercel limits', () => {
    const tag = bossCacheTag(`zulrah-${'x'.repeat(500)}`);
    expect(Buffer.byteLength(tag, 'utf8')).toBeLessThanOrEqual(256);
    expect(tag).toMatch(/^boss:sha256-[a-f0-9]{64}$/);
  });

  it('caps response tags at Vercel\'s 128-tag limit', async () => {
    const app = new Hono();
    app.get('/', (c) => {
      setSharedCache(
        c,
        cachePolicies.publicData,
        Array.from({ length: 140 }, (_, index) => `tag-${index}`)
      );
      return c.text('ok');
    });

    const response = await app.request('/');
    expect(response.headers.get('vercel-cache-tag')?.split(',')).toHaveLength(128);
  });

  it('assigns each boss to one stable dependency bucket', () => {
    const tag = profileBossBucketCacheTag('Zulrah');
    expect(profileBossBucketCacheTag(' zulrah ')).toBe(tag);
    expect(tag).toMatch(/^profile-boss-bucket:(?:[0-9]|[12][0-9]|3[01])$/);
  });

  it('builds an exact per-boss profile dependency tag', () => {
    expect(profileBossExactCacheTag('Zulrah')).toBe('profile-boss:zulrah');
    expect(profileBossExactCacheTag(' ZULRAH ')).toBe(profileBossExactCacheTag('zulrah'));
  });

  it('reports whether a profile fits under the exact-tag threshold', () => {
    // The name route reserves 2 tag slots (player-name + player-id), so exact
    // tags are safe up to 126 PBs, keeping the total at or below Vercel's
    // 128-tag response limit.
    expect(fitsExactProfileTags(126)).toBe(true);
    expect(fitsExactProfileTags(127)).toBe(false);
  });

  it('deduplicates tags before invalidating on Vercel', async () => {
    process.env.VERCEL = '1';
    await invalidateSharedCache(['stats', 'boss:zulrah', 'stats']);
    expect(mocks.invalidateByTag).toHaveBeenCalledOnce();
    expect(mocks.invalidateByTag).toHaveBeenCalledWith(['stats', 'boss:zulrah']);
  });

  it('does not call Vercel during local execution', async () => {
    delete process.env.VERCEL;
    await invalidateSharedCache(['stats']);
    expect(mocks.invalidateByTag).not.toHaveBeenCalled();
  });
});
