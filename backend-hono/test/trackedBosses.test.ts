import { describe, expect, it } from 'vitest';
import { isRedundantDuplicateKey, isTrackedBoss } from '../src/lib/trackedBosses.js';

describe('isTrackedBoss', () => {
  it('accepts bosses with an official Jagex personal best', () => {
    expect(isTrackedBoss('zulrah')).toBe(true);
    expect(isTrackedBoss('Vorkath')).toBe(true);
    expect(isTrackedBoss('the whisperer')).toBe(true);
  });

  it('accepts Adventure Log-derived variant labels for tracked activities', () => {
    expect(isTrackedBoss('Theatre of Blood - Fastest Room (3 player)')).toBe(true);
    expect(isTrackedBoss('tombs of amascut expert mode')).toBe(true);
    expect(isTrackedBoss('chambers of xeric challenge mode')).toBe(true);
  });

  it('rejects bosses with no official Jagex personal best', () => {
    expect(isTrackedBoss('dagannoth prime')).toBe(false);
    expect(isTrackedBoss('dagannoth rex')).toBe(false);
    expect(isTrackedBoss('dagannoth supreme')).toBe(false);
    expect(isTrackedBoss('general graardor')).toBe(false);
    expect(isTrackedBoss('cerberus')).toBe(false);
    expect(isTrackedBoss('giant mole')).toBe(false);
    expect(isTrackedBoss('barrows chests')).toBe(false);
  });

  it('rejects made-up/spoofed boss names', () => {
    expect(isTrackedBoss('yomamma')).toBe(false);
  });

  it('distinguishes The Nightmare from Phosani\'s Nightmare, both tracked', () => {
    expect(isTrackedBoss('the nightmare')).toBe(true);
    expect(isTrackedBoss("phosani's nightmare")).toBe(true);
  });
});

describe('isRedundantDuplicateKey', () => {
  it('rejects bare "mode" keys with no team-size suffix', () => {
    expect(isRedundantDuplicateKey('theatre of blood hard mode')).toBe(true);
    expect(isRedundantDuplicateKey('Theatre of Blood Entry Mode')).toBe(true);
    expect(isRedundantDuplicateKey('chambers of xeric challenge mode')).toBe(true);
    expect(isRedundantDuplicateKey('tombs of amascut expert mode')).toBe(true);
    expect(isRedundantDuplicateKey('tombs of amascut entry mode')).toBe(true);
  });

  it('accepts the same modes once a team-size suffix is present', () => {
    expect(isRedundantDuplicateKey('theatre of blood hard mode solo')).toBe(false);
    expect(isRedundantDuplicateKey('tombs of amascut expert mode 4 players')).toBe(false);
  });

  it('rejects bare "nightmare <team size>" keys', () => {
    expect(isRedundantDuplicateKey('nightmare solo')).toBe(true);
    expect(isRedundantDuplicateKey('Nightmare 2 Players')).toBe(true);
    expect(isRedundantDuplicateKey('nightmare 6+ players')).toBe(true);
    expect(isRedundantDuplicateKey('nightmare 3-4 players')).toBe(true);
  });

  it('does not reject unrelated tracked bosses', () => {
    expect(isRedundantDuplicateKey('zulrah')).toBe(false);
    expect(isRedundantDuplicateKey('theatre of blood')).toBe(false);
    expect(isRedundantDuplicateKey('chambers of xeric')).toBe(false);
    expect(isRedundantDuplicateKey('the nightmare')).toBe(false);
    expect(isRedundantDuplicateKey("phosani's nightmare")).toBe(false);
  });
});
