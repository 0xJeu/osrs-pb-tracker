import { beforeEach, describe, expect, it } from 'vitest';
import { parseRecoveryId } from '../src/components/RecoveryHelpPage';
import { routeFromPath } from '../src/hooks/useRoute';

describe('install recovery route', () => {
  beforeEach(() => window.history.replaceState({}, '', '/'));

  it('reads a safe recovery ID and state from the plugin help URL', () => {
    window.history.replaceState({}, '', '/recovery?id=42&state=RECOVERY_CONTESTED');
    expect(routeFromPath()).toEqual({
      name: 'recovery',
      recoveryId: 42,
      state: 'RECOVERY_CONTESTED',
    });
  });

  it('drops malformed recovery IDs instead of attaching support to another candidate', () => {
    window.history.replaceState({}, '', '/recovery?id=42oops');
    expect(routeFromPath()).toEqual({ name: 'recovery', recoveryId: undefined, state: undefined });
    expect(parseRecoveryId('0')).toBeNull();
    expect(parseRecoveryId('-4')).toBeNull();
    expect(parseRecoveryId('12')).toBe(12);
  });
});
