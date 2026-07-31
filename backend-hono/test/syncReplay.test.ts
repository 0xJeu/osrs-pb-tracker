import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  expireTag: vi.fn(),
  get: vi.fn(),
  set: vi.fn(),
}));

vi.mock('@vercel/functions', () => ({
  getCache: () => ({
    get: mocks.get,
    set: mocks.set,
    expireTag: mocks.expireTag,
  }),
}));

describe('invalidatePlayerSyncReplay', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mocks.expireTag.mockReset();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('does not throw, and reports failure, when the cache backend fails', async () => {
    mocks.expireTag.mockRejectedValueOnce(new Error('cache outage'));
    const { invalidatePlayerSyncReplay } = await import('../src/lib/syncReplay.js');

    // A caller like promoteInstallRecoveryCandidate runs this after its
    // database mutation has already committed - it must never surface a
    // cache-layer failure as if the mutation itself had failed. It still
    // needs to know invalidation didn't happen, so callers for whom that's a
    // correctness dependency (candidate capture) can react.
    await expect(invalidatePlayerSyncReplay(42)).resolves.toBe(false);
    expect(warnSpy).toHaveBeenCalledWith(
      'Unable to invalidate PB sync replay cache for player',
      expect.objectContaining({ playerId: 42 })
    );
  });

  it('reports success and scopes the expired tag to just the given player', async () => {
    mocks.expireTag.mockResolvedValueOnce(undefined);
    const { invalidatePlayerSyncReplay } = await import('../src/lib/syncReplay.js');

    await expect(invalidatePlayerSyncReplay(7)).resolves.toBe(true);
    expect(mocks.expireTag).toHaveBeenCalledWith(expect.stringContaining('-player-7'));
  });
});

describe('captureInstallRecoveryCandidate with a failing replay cache', () => {
  beforeEach(() => {
    mocks.expireTag.mockReset();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps invalidation in flight non-promotable and returns a concurrent contest', async () => {
    let releaseInvalidation!: () => void;
    mocks.expireTag.mockImplementationOnce(
      () => new Promise<void>((resolve) => {
        releaseInvalidation = resolve;
      })
    );

    const { db } = await import('../src/db/client.js');
    const { installRecoveryCandidates, players } = await import('../src/db/schema.js');
    const {
      captureInstallRecoveryCandidate,
      promoteInstallRecoveryCandidate,
      RecoveryDecisionConflictError,
    } = await import('../src/lib/installRecovery.js');
    const { truncateAll } = await import('./helpers.js');

    await truncateAll();
    const [player] = await db
      .insert(players)
      .values({
        accountHash: 'replay-in-flight-account',
        displayName: 'ReplayInFlightPlayer',
        displayNameLower: 'replayinflightplayer',
        installSecretHash: 'incumbent-secret-hash-for-in-flight-test',
        updatedAt: new Date(),
      })
      .returning();
    const firstValues = {
      playerId: player.id,
      incumbentSecretHash: 'incumbent-secret-hash-for-in-flight-test',
      candidateSecretHash: 'first-candidate-secret-hash',
      displayName: 'ReplayInFlightPlayer',
      receivedCount: 1,
      pbsByBoss: new Map([['zulrah', 80]]),
    };

    const firstCapture = captureInstallRecoveryCandidate(firstValues);
    await vi.waitFor(() => expect(mocks.expireTag).toHaveBeenCalledTimes(1));
    const [inFlight] = await db.select().from(installRecoveryCandidates);
    expect(inFlight.status).toBe('invalidation_pending');
    await expect(
      promoteInstallRecoveryCandidate(inFlight.id, 'local-test-admin')
    ).rejects.toBeInstanceOf(RecoveryDecisionConflictError);

    const competing = await captureInstallRecoveryCandidate({
      ...firstValues,
      candidateSecretHash: 'second-candidate-secret-hash',
    });
    expect(competing.status).toBe('contested');
    releaseInvalidation();
    const first = await firstCapture;

    expect(first.status).toBe('contested');
    const candidates = await db.select().from(installRecoveryCandidates);
    expect(candidates.map((candidate) => candidate.status)).toEqual(['contested', 'contested']);
  });

  it('does not let a retry adopt an abandoned invalidation attempt', async () => {
    mocks.expireTag.mockResolvedValue(undefined);
    const { db } = await import('../src/db/client.js');
    const { installRecoveryCandidates, players } = await import('../src/db/schema.js');
    const { captureInstallRecoveryCandidate } = await import('../src/lib/installRecovery.js');
    const { truncateAll } = await import('./helpers.js');

    await truncateAll();
    const [player] = await db
      .insert(players)
      .values({
        accountHash: 'abandoned-invalidation-account',
        displayName: 'AbandonedInvalidationPlayer',
        displayNameLower: 'abandonedinvalidationplayer',
        installSecretHash: 'incumbent-secret-hash-for-abandoned-test',
        updatedAt: new Date(),
      })
      .returning();
    await db.insert(installRecoveryCandidates).values({
      playerId: player.id,
      incumbentSecretHash: 'incumbent-secret-hash-for-abandoned-test',
      candidateSecretHash: 'candidate-secret-hash-for-abandoned-test',
      status: 'invalidation_pending',
      displayName: 'AbandonedInvalidationPlayer',
      payload: { zulrah: 80 },
      payloadDigest: 'abandoned-invalidation-payload-digest',
      receivedCount: 1,
      eligibleCount: 1,
      equalCount: 0,
      improvedCount: 0,
      newCount: 1,
      slowerCount: 0,
      missingCount: 0,
      firstSeenAt: new Date(),
      lastSeenAt: new Date(),
    });

    const result = await captureInstallRecoveryCandidate({
      playerId: player.id,
      incumbentSecretHash: 'incumbent-secret-hash-for-abandoned-test',
      candidateSecretHash: 'candidate-secret-hash-for-abandoned-test',
      displayName: 'AbandonedInvalidationPlayer',
      receivedCount: 1,
      pbsByBoss: new Map([['zulrah', 80]]),
    });

    expect(result.status).toBe('invalidation_pending');
    expect(result.attemptCount).toBe(2);
    expect(mocks.expireTag).not.toHaveBeenCalled();
  });

  it('stays non-promotable after a later successful invalidation', async () => {
    mocks.expireTag.mockRejectedValueOnce(new Error('cache outage'));

    const { db } = await import('../src/db/client.js');
    const { installRecoveryCandidates, installRecoveryEvents, players } = await import(
      '../src/db/schema.js'
    );
    const { captureInstallRecoveryCandidate } = await import('../src/lib/installRecovery.js');
    const { truncateAll } = await import('./helpers.js');

    await truncateAll();

    const [player] = await db
      .insert(players)
      .values({
        accountHash: 'replay-failure-account',
        displayName: 'ReplayFailurePlayer',
        displayNameLower: 'replayfailureplayer',
        installSecretHash: 'incumbent-secret-hash-for-this-test',
        updatedAt: new Date(),
      })
      .returning();

    const candidateValues = {
      playerId: player.id,
      incumbentSecretHash: 'incumbent-secret-hash-for-this-test',
      candidateSecretHash: 'candidate-secret-hash-for-this-test',
      displayName: 'ReplayFailurePlayer',
      receivedCount: 1,
      pbsByBoss: new Map([['zulrah', 80]]),
    };
    const result = await captureInstallRecoveryCandidate(candidateValues);

    // Without confirmed invalidation, a still-cached incumbent success could
    // silently bypass noteIncumbentCredentialSeen() - so this must not come
    // back "pending" (promotable) just because the DB write itself succeeded.
    expect(result.status).toBe('invalidation_failed');

    const [candidateRow] = await db
      .select()
      .from(installRecoveryCandidates)
      .where(eq(installRecoveryCandidates.id, result.id));
    expect(candidateRow.status).toBe('invalidation_failed');

    const [failureEvent] = await db
      .select()
      .from(installRecoveryEvents)
      .where(eq(installRecoveryEvents.candidateId, result.id));
    expect(failureEvent).toMatchObject({
      eventType: 'replay_invalidation_unconfirmed',
      actor: 'system',
    });

    mocks.expireTag.mockResolvedValueOnce(undefined);
    const retried = await captureInstallRecoveryCandidate(candidateValues);
    expect(retried).toMatchObject({
      id: result.id,
      status: 'invalidation_failed',
      attemptCount: 2,
    });

    const [retriedRow] = await db
      .select()
      .from(installRecoveryCandidates)
      .where(eq(installRecoveryCandidates.id, result.id));
    expect(retriedRow.status).toBe('invalidation_failed');

    const events = await db
      .select()
      .from(installRecoveryEvents)
      .where(eq(installRecoveryEvents.candidateId, result.id));
    expect(events.map((event) => event.eventType)).toEqual([
      'replay_invalidation_unconfirmed',
    ]);
  });
});
