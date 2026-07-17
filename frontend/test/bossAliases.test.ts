import { describe, expect, it } from 'vitest';
import { bossSearchAliasTarget, matchesBossSearch } from '../src/lib/bossAliases';

describe('boss search aliases', () => {
  it('maps common raid abbreviations to canonical boss names', () => {
    expect(bossSearchAliasTarget('ToA')).toBe('tombs of amascut');
    expect(bossSearchAliasTarget('TOB')).toBe('theatre of blood');
    expect(bossSearchAliasTarget('CoX')).toBe('chambers of xeric');
  });

  it('supports common hard and challenge mode abbreviations', () => {
    expect(bossSearchAliasTarget('CoX CM')).toBe('chambers of xeric challenge mode');
    expect(bossSearchAliasTarget('HMT')).toBe('theatre of blood hard mode');
  });

  it('matches an alias against canonical synced boss keys', () => {
    expect(matchesBossSearch('tombs of amascut - expert mode', 'toa')).toBe(true);
    expect(matchesBossSearch('zulrah', 'toa')).toBe(false);
  });
});
