import { describe, expect, it } from 'vitest';
import { CURATED_OVERVIEW_BOSSES } from '../src/lib/curatedOverviewBosses.js';
import { isTrackedBoss } from '../src/lib/trackedBosses.js';

describe('CURATED_OVERVIEW_BOSSES', () => {
  it('is a non-empty, deduplicated list', () => {
    expect(CURATED_OVERVIEW_BOSSES.length).toBeGreaterThan(0);
    expect(new Set(CURATED_OVERVIEW_BOSSES).size).toBe(CURATED_OVERVIEW_BOSSES.length);
  });

  it('only contains bosses the sync route would actually accept', () => {
    for (const boss of CURATED_OVERVIEW_BOSSES) {
      expect(isTrackedBoss(boss)).toBe(true);
    }
  });

  it('only contains already-lowercased keys', () => {
    for (const boss of CURATED_OVERVIEW_BOSSES) {
      expect(boss).toBe(boss.toLowerCase());
    }
  });
});
