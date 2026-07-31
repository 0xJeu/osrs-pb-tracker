import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../src/app.js';
import {
  playerIdCacheTag,
  playerNameCacheTag,
  profileBossBucketCacheTag,
  profileBossExactCacheTag,
} from '../src/lib/cache.js';
import { truncateAll } from './helpers.js';

// Focused boundary tests for the 126-PB exact/bucket cache-tag threshold
// (see src/lib/cache.ts's MAX_EXACT_PROFILE_TAGS and players.ts's
// profileCacheTags). Kept out of players.test.ts because seeding 125-127
// PBs per scenario would make that file's setup unwieldy.
//
// Synthetic boss keys: src/lib/trackedBosses.ts's isTrackedBoss does PREFIX
// matching ("zulrah variant 0".startsWith('zulrah') is true), so distinct
// "zulrah variant N" strings are all accepted by the sync route's allowlist,
// are each a distinct (player_id, boss) row, and don't hit the
// REDUNDANT_BARE_MODE_KEYS/NIGHTMARE_TEAM_SIZE_PATTERN dedup rules (those
// only match specific raid-mode/nightmare strings, not "zulrah ..."). This
// lets one player accumulate 125+ distinct tracked-boss PBs without needing
// 125 different real bosses.
function syntheticBossPbs(count: number): Record<string, number> {
  const pbs: Record<string, number> = {};
  for (let i = 0; i < count; i++) {
    pbs[`zulrah variant ${i}`] = 60 + i;
  }
  return pbs;
}

function syncRequest(body: unknown) {
  return app.request('/api/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('126-PB exact/bucket cache-tag threshold', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('stays below 128 unique tags and uses exact tags for a 125-PB profile', async () => {
    const secret = 'a'.repeat(20);
    const res = await syncRequest({
      accountHash: 'boundary-125-account',
      displayName: 'Boundary125',
      installSecret: secret,
      pbs: syntheticBossPbs(125),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    // Confirms the synthetic-variant trick genuinely lands 125 distinct rows
    // through the real sync flow, not just a hand-seeded DB assumption.
    expect(json.updated).toBe(125);

    const lookup = await app.request('/api/players/boundary125');
    expect(lookup.status).toBe(200);
    const tags = (lookup.headers.get('vercel-cache-tag') ?? '').split(',');

    expect(tags.length).toBeLessThan(128);
    expect(tags.filter((tag) => tag.startsWith('profile-boss:')).length).toBe(125);
    expect(tags.some((tag) => tag.startsWith('profile-boss-bucket:'))).toBe(false);
  });

  it('reaches exactly 128 tags (the boundary) for a 126-PB profile, still all exact', async () => {
    const secret = 'a'.repeat(20);
    const res = await syncRequest({
      accountHash: 'boundary-126-account',
      displayName: 'Boundary126',
      installSecret: secret,
      pbs: syntheticBossPbs(126),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).updated).toBe(126);

    const lookup = await app.request('/api/players/boundary126');
    expect(lookup.status).toBe(200);
    const tags = (lookup.headers.get('vercel-cache-tag') ?? '').split(',');

    // 1 player-name tag + 1 player-id tag + 126 exact boss tags = 128,
    // exactly Vercel's cap - the precise boundary the design targets.
    expect(tags.length).toBe(128);
    expect(tags.filter((tag) => tag.startsWith('profile-boss:')).length).toBe(126);
    expect(tags.some((tag) => tag.startsWith('profile-boss-bucket:'))).toBe(false);
  });

  it('switches entirely to bucket tags (no truncation) for a 127-PB profile', async () => {
    const secret = 'a'.repeat(20);
    const res = await syncRequest({
      accountHash: 'boundary-127-account',
      displayName: 'Boundary127',
      installSecret: secret,
      pbs: syntheticBossPbs(127),
    });
    expect(res.status).toBe(200);
    const syncJson = await res.json();
    expect(syncJson.updated).toBe(127);

    const lookup = await app.request('/api/players/boundary127');
    expect(lookup.status).toBe(200);
    const payload = await lookup.json();
    const tags = (lookup.headers.get('vercel-cache-tag') ?? '').split(',');

    // A naive per-boss-tag-capped-at-128 implementation would still show
    // some "profile-boss:" exact tags here (up to the cap) and silently drop
    // the rest. The real design switches schemes entirely, so there must be
    // ZERO exact tags once the profile exceeds the threshold.
    expect(tags.filter((tag) => tag.startsWith('profile-boss:')).length).toBe(0);
    expect(tags.some((tag) => tag.startsWith('profile-boss-bucket:'))).toBe(true);
    expect(tags.length).toBeLessThan(128);

    // Confirms the switch to buckets (not truncation) is what kept the
    // response under the cap: the player-id/player-name tags are still
    // present, proving nothing about the response's own identity was
    // dropped to make room.
    expect(tags).toContain(playerNameCacheTag('boundary127'));
    expect(tags).toContain(playerIdCacheTag(payload.id));
  });
});

// Step 4 of the boundary-tests plan (changing one boss invalidates both the
// exact and bucket profile tags) is already covered by sync.test.ts's
// "invalidates both the exact and bucket profile tags for a changed boss"
// test and the strengthened improvement-only test alongside it - not
// duplicated here.

describe('bucket-fallback profile (127+ PBs): player-id/player-name invalidation is not lost', () => {
  const mocks = vi.hoisted(() => ({ invalidateByTag: vi.fn() }));

  vi.mock('@vercel/functions', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@vercel/functions')>();
    return { ...actual, invalidateByTag: mocks.invalidateByTag };
  });

  const originalVercel = process.env.VERCEL;

  beforeEach(async () => {
    await truncateAll();
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

  it('still invalidates player-id and player-name tags for a rename + boss improvement on a 127-PB (bucket-fallback) profile', async () => {
    const secret = 'a'.repeat(20);
    const created = await syncRequest({
      accountHash: 'bucket-fallback-account',
      displayName: 'BucketFallbackPlayer',
      installSecret: secret,
      pbs: syntheticBossPbs(127),
    });
    expect(created.status).toBe(200);
    const { playerId } = await created.json();

    // The initial 127-boss seed sync pushes ~380 tags (playerId + 127 *
    // [boss, exact, bucket]) to invalidateSharedCache, well past Vercel's
    // 128-tags-per-call limit - regression coverage for the chunking fix in
    // invalidateSharedCache (src/lib/cache.ts). Without chunking, this would
    // still be a single oversized call; deleting the chunking loop would not
    // fail any OTHER existing test, since none else pushes this many tags in
    // one sync.
    const seedCalls = mocks.invalidateByTag.mock.calls;
    expect(seedCalls.length).toBeGreaterThan(1);
    for (const call of seedCalls) {
      expect((call[0] as string[]).length).toBeLessThanOrEqual(128);
    }

    mocks.invalidateByTag.mockReset();

    // Rename AND improve one boss in the same sync so both the
    // metadataChanged (player-name) and changedBosses (player-id) branches
    // of sync.ts's invalidation logic fire together, specifically for a
    // profile large enough to be on the bucket-tag side of the threshold -
    // distinct from Task 5's existing "invalidates both the exact and
    // bucket profile tags" coverage, which uses a single-boss (exact-tag)
    // profile.
    const updated = await syncRequest({
      accountHash: 'bucket-fallback-account',
      displayName: 'BucketFallbackPlayerRenamed',
      installSecret: secret,
      pbs: { 'zulrah variant 0': 1 }, // faster than its seeded time (60)
    });
    expect(updated.status).toBe(200);
    expect((await updated.json()).updated).toBe(1);

    const tags = mocks.invalidateByTag.mock.calls.flatMap((call) => call[0] as string[]);

    expect(tags).toContain(playerIdCacheTag(playerId));
    expect(tags).toContain(playerNameCacheTag('bucketfallbackplayer'));
    expect(tags).toContain(playerNameCacheTag('bucketfallbackplayerrenamed'));
    // The changed boss's exact AND bucket tags are both invalidated
    // regardless of which scheme this specific profile's cached response
    // currently uses - this profile is a concrete case on the bucket side.
    expect(tags).toContain(profileBossExactCacheTag('zulrah variant 0'));
    expect(tags).toContain(profileBossBucketCacheTag('zulrah variant 0'));
  });
});
