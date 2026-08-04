import { describe, expect, it } from 'vitest';
import { summarizePlayerRecords } from '../src/components/PlayerView';
import { groupPlayerRaidPbs } from '../src/lib/bossGroups';

describe('player summary', () => {
  it('counts every rank-one raid variant while naming the best collapsed boss row', () => {
    const pbs = [
      { boss: 'maggot king', timeSeconds: 62.4, updatedAt: '2026-07-13T00:00:00Z', rank: 2 },
      { boss: 'tombs of amascut - fastest overall (2 player)', timeSeconds: 1043.4, updatedAt: '2026-07-13T00:00:00Z', rank: 1 },
      { boss: 'tombs of amascut - fastest room (2 player)', timeSeconds: 912.6, updatedAt: '2026-07-13T00:00:00Z', rank: 1 },
      { boss: 'theatre of blood - fastest overall (1 player)', timeSeconds: 2840.4, updatedAt: '2026-07-13T00:00:00Z', rank: 1 },
      { boss: 'theatre of blood - fastest overall (5 player)', timeSeconds: 1011, updatedAt: '2026-07-13T00:00:00Z', rank: 19 },
      { boss: 'theatre of blood - fastest room (1 player)', timeSeconds: 2666.4, updatedAt: '2026-07-13T00:00:00Z', rank: 1 },
    ];
    const { flat, groups } = groupPlayerRaidPbs(pbs);

    expect(summarizePlayerRecords(pbs, flat, groups)).toEqual({
      bestRankedBoss: 'Tombs Of Amascut',
      bestRank: 1,
      numberOneRecords: 4,
    });
  });
});
