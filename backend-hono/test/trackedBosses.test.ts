import { describe, expect, it } from 'vitest';
import { isTrackedBoss } from '../src/lib/trackedBosses.js';

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
