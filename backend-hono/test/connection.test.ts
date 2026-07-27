import { describe, expect, it } from 'vitest';
import { resolveDatabaseUrl } from '../src/db/connection.js';

describe('resolveDatabaseUrl', () => {
  it('selects the explicit primary by default', () => {
    expect(
      resolveDatabaseUrl({
        DATABASE_URL_PRIMARY: 'postgresql://primary',
        DATABASE_URL_STANDBY: 'postgresql://standby',
      })
    ).toBe('postgresql://primary');
  });

  it('keeps DATABASE_URL as a backward-compatible primary fallback', () => {
    expect(
      resolveDatabaseUrl({
        DATABASE_URL: 'postgresql://legacy-primary',
      })
    ).toBe('postgresql://legacy-primary');
  });

  it('selects the standby only when explicitly requested', () => {
    expect(
      resolveDatabaseUrl({
        DATABASE_TARGET: 'standby',
        DATABASE_URL_PRIMARY: 'postgresql://primary',
        DATABASE_URL_STANDBY: 'postgresql://standby',
      })
    ).toBe('postgresql://standby');
  });

  it('normalizes whitespace and case in the target', () => {
    expect(
      resolveDatabaseUrl({
        DATABASE_TARGET: ' StandBy ',
        DATABASE_URL_STANDBY: 'postgresql://standby',
      })
    ).toBe('postgresql://standby');
  });

  it('fails closed when the selected target has no URL', () => {
    expect(() =>
      resolveDatabaseUrl({
        DATABASE_TARGET: 'standby',
        DATABASE_URL_PRIMARY: 'postgresql://primary',
      })
    ).toThrow('Standby database target requires DATABASE_URL_STANDBY');
  });

  it('rejects an unknown target instead of guessing', () => {
    expect(() =>
      resolveDatabaseUrl({
        DATABASE_TARGET: 'automatic',
        DATABASE_URL_PRIMARY: 'postgresql://primary',
        DATABASE_URL_STANDBY: 'postgresql://standby',
      })
    ).toThrow('DATABASE_TARGET must be either "primary" or "standby"');
  });
});
