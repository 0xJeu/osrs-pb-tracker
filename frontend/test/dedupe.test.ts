import { describe, expect, it } from 'vitest';
import { hideAmbiguousBaseEntries } from '../src/lib/dedupe';

describe('hideAmbiguousBaseEntries', () => {
  it('hides a bare base entry when a more specific variant exists', () => {
    const items = ['theatre of blood', 'theatre of blood - fastest room (4 player)'];
    expect(hideAmbiguousBaseEntries(items, (x) => x)).toEqual([
      'theatre of blood - fastest room (4 player)',
    ]);
  });

  it('keeps entries with no more-specific variant', () => {
    const items = ['zulrah', 'vorkath'];
    expect(hideAmbiguousBaseEntries(items, (x) => x)).toEqual(['zulrah', 'vorkath']);
  });

  it('compares case-insensitively', () => {
    const items = ['Theatre Of Blood', 'theatre of blood - fastest room'];
    expect(hideAmbiguousBaseEntries(items, (x) => x)).toEqual([
      'theatre of blood - fastest room',
    ]);
  });

  it('works through an accessor for object items', () => {
    const items = [
      { boss: 'tombs of amascut', timeSeconds: 1535 },
      { boss: 'tombs of amascut - fastest room (4 player)', timeSeconds: 1641 },
    ];
    expect(hideAmbiguousBaseEntries(items, (x) => x.boss)).toEqual([items[1]]);
  });
});
