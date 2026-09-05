import { describe, expect, it } from 'vitest';
import { isTrackedBoss } from '../src/lib/trackedBosses';

describe('isTrackedBoss', () => {
  it('accepts bosses with an official Jagex personal best', () => {
    expect(isTrackedBoss('zulrah')).toBe(true);
    expect(isTrackedBoss('Vorkath')).toBe(true);
    expect(isTrackedBoss('the whisperer')).toBe(true);
  });

  it('accepts Adventure Log-derived variant labels for tracked activities', () => {
    expect(isTrackedBoss('Theatre of Blood - Fastest Room (3 player)')).toBe(true);
    expect(isTrackedBoss('tombs of amascut expert mode')).toBe(true);
  });

  it('accepts timed Doom of Mokhaiotl delve keys', () => {
    expect(isTrackedBoss('doom of mokhaiotl - delve 1')).toBe(true);
    expect(isTrackedBoss('Doom of Mokhaiotl - Delve 8')).toBe(true);
    expect(isTrackedBoss('Doom of Mokhaiotl - Delve 8+')).toBe(true);
  });

  it('rejects unsupported Doom record shapes', () => {
    expect(isTrackedBoss('doom of mokhaiotl')).toBe(false);
    expect(isTrackedBoss('doom of mokhaiotl deepest delve')).toBe(false);
    expect(isTrackedBoss('doom of mokhaiotl - delve 9')).toBe(false);
    expect(isTrackedBoss('doom of mokhaiotl nonsense')).toBe(false);
  });

  it('rejects bosses with no official Jagex personal best', () => {
    expect(isTrackedBoss('dagannoth prime')).toBe(false);
    expect(isTrackedBoss('dagannoth rex')).toBe(false);
    expect(isTrackedBoss('general graardor')).toBe(false);
    expect(isTrackedBoss('cerberus')).toBe(false);
  });
});
