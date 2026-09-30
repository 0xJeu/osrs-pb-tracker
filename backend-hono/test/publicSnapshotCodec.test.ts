import { describe, expect, it } from 'vitest';
import {
  decodePublicSnapshot,
  encodePublicSnapshot,
} from '../src/lib/public-read-model/codec.js';
import {
  isPublicSnapshotV1,
  type PublicSnapshotV1,
} from '../src/lib/public-read-model/schema.js';

const snapshot: PublicSnapshotV1 = {
  schemaVersion: 1,
  revision: '42',
  generatedAt: '2026-09-29T00:00:00.000Z',
  sourceCounts: { players: 1, nameHistory: 0, personalBests: 1, bosses: 1 },
  bosses: ['zulrah'],
  playerIdsByLookupName: { blitzen: [1] },
  profilesByPlayerId: {
    '1': {
      id: 1,
      displayName: 'Blitzen',
      updatedAt: '2026-09-29T00:00:00.000Z',
      pbs: [{
        boss: 'zulrah',
        timeSeconds: 80,
        updatedAt: '2026-09-29T00:00:00.000Z',
        rank: 1,
      }],
    },
  },
};

describe('public snapshot codec', () => {
  it('round-trips the complete versioned snapshot', async () => {
    const stored = await encodePublicSnapshot(snapshot);
    expect(stored.encoding).toBe('br+base64');
    expect(stored.revision).toBe('42');
    expect(await decodePublicSnapshot(stored)).toEqual(snapshot);
  });

  it('rejects a corrupted payload', async () => {
    const stored = await encodePublicSnapshot(snapshot);
    stored.payload = `${stored.payload.slice(0, -4)}AAAA`;
    await expect(decodePublicSnapshot(stored)).rejects.toThrow();
  });

  it('rejects an unsafe declared expansion before decompressing', async () => {
    const stored = await encodePublicSnapshot(snapshot);
    stored.uncompressedBytes = 20_000_001;
    await expect(decodePublicSnapshot(stored)).rejects.toThrow('safe decode limits');
  });

  it('rejects inconsistent profile keys, lookup references, and revisions', () => {
    expect(isPublicSnapshotV1({ ...snapshot, revision: 'not-a-revision' })).toBe(false);
    expect(isPublicSnapshotV1({
      ...snapshot,
      profilesByPlayerId: { '2': snapshot.profilesByPlayerId['1'] },
    })).toBe(false);
    expect(isPublicSnapshotV1({
      ...snapshot,
      playerIdsByLookupName: { blitzen: [999] },
    })).toBe(false);
  });
});
