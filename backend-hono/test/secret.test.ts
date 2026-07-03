import { describe, expect, it } from 'vitest';
import { hashSecret, isRateLimited, resetRateLimiter } from '../src/lib/secret';

describe('hashSecret', () => {
  it('produces a stable sha256 hex digest', () => {
    expect(hashSecret('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    );
  });

  it('produces different hashes for different inputs', () => {
    expect(hashSecret('abc')).not.toBe(hashSecret('abd'));
  });
});

describe('isRateLimited', () => {
  it('allows requests under the limit', () => {
    resetRateLimiter();
    for (let i = 0; i < 30; i += 1) {
      expect(isRateLimited('key-a')).toBe(false);
    }
  });

  it('blocks the 31st request within the window', () => {
    resetRateLimiter();
    for (let i = 0; i < 30; i += 1) {
      isRateLimited('key-b');
    }
    expect(isRateLimited('key-b')).toBe(true);
  });

  it('resets after the window passes', () => {
    resetRateLimiter();
    const start = 1_000_000;
    for (let i = 0; i < 30; i += 1) {
      isRateLimited('key-c', start);
    }
    expect(isRateLimited('key-c', start + 11 * 60 * 1000)).toBe(false);
  });

  it('tracks separate keys independently', () => {
    resetRateLimiter();
    for (let i = 0; i < 30; i += 1) {
      isRateLimited('key-d');
    }
    expect(isRateLimited('key-e')).toBe(false);
  });
});
