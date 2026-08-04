import { describe, expect, it } from 'vitest';
import { summarizePlayerRecords } from '../src/components/PlayerView';

describe('player summary', () => {
  it('counts every rank-one raid variant and lists each boss once', () => {
    const pbs = [
      { boss: 'maggot king', timeSeconds: 62.4, updatedAt: '2026-07-13T00:00:00Z', rank: 2 },
      { boss: 'tombs of amascut - fastest overall (2 player)', timeSeconds: 1043.4, updatedAt: '2026-07-13T00:00:00Z', rank: 1 },
      { boss: 'tombs of amascut - fastest room (2 player)', timeSeconds: 912.6, updatedAt: '2026-07-13T00:00:00Z', rank: 1 },
      { boss: 'theatre of blood - fastest overall (1 player)', timeSeconds: 2840.4, updatedAt: '2026-07-13T00:00:00Z', rank: 1 },
      { boss: 'theatre of blood - fastest overall (5 player)', timeSeconds: 1011, updatedAt: '2026-07-13T00:00:00Z', rank: 19 },
      { boss: 'theatre of blood - fastest room (1 player)', timeSeconds: 2666.4, updatedAt: '2026-07-13T00:00:00Z', rank: 1 },
    ];
    expect(summarizePlayerRecords(pbs)).toEqual({
      numberOneRecords: 4,
      numberOneBosses: ['Theatre Of Blood', 'Tombs Of Amascut'],
    });
  });
});
