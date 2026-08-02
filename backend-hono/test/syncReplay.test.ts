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
    // cache-layer failure as if the mutation itself had failed. Replacement
    // and revocation use the result for observability, while additive recovery
    // deliberately does not depend on replay invalidation.
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

describe('additive recovery is independent of replay invalidation', () => {
  beforeEach(() => {
    mocks.expireTag.mockReset();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('captures and approves an additional install even when replay invalidation is unavailable', async () => {
    mocks.expireTag.mockRejectedValue(new Error('cache outage'));
    const { db } = await import('../src/db/client.js');
    const { playerInstallCredentials, players } = await import('../src/db/schema.js');
    const {
      captureInstallRecoveryCandidate,
      promoteInstallRecoveryCandidate,
    } = await import('../src/lib/installRecovery.js');
    const { truncateAll } = await import('./helpers.js');

    await truncateAll();
    const now = new Date();
    const [player] = await db
      .insert(players)
      .values({
        accountHash: 'cache-independent-account',
        displayName: 'CacheIndependentPlayer',
        displayNameLower: 'cacheindependentplayer',
        installSecretHash: 'incumbent-secret-hash',
        updatedAt: now,
      })
      .returning();
    await db.insert(playerInstallCredentials).values({
      playerId: player.id,
      secretHash: 'incumbent-secret-hash',
      status: 'active',
      source: 'legacy',
      firstSeenAt: now,
      lastSeenAt: now,
      authorizedAt: now,
    });

    const result = await captureInstallRecoveryCandidate({
      playerId: player.id,
      incumbentSecretHash: 'incumbent-secret-hash',
      candidateSecretHash: 'candidate-secret-hash',
      displayName: 'CacheIndependentPlayer',
      receivedCount: 1,
      pbsByBoss: new Map([['zulrah', 80]]),
    });

    expect(result.status).toBe('pending');
    expect(mocks.expireTag).not.toHaveBeenCalled();
    await expect(
      promoteInstallRecoveryCandidate(result.id, 'local-test-admin', 'Cache-independent approval.')
    ).resolves.toMatchObject({ mode: 'additional' });
  });

  it('reopens a legacy invalidation-failed row for safe additive review', async () => {
    const { db } = await import('../src/db/client.js');
    const { installRecoveryCandidates, players } = await import(
      '../src/db/schema.js'
    );
    const { reopenRejectedInstallRecoveryCandidate } = await import('../src/lib/installRecovery.js');
    const { truncateAll } = await import('./helpers.js');
    await truncateAll();
    const [player] = await db
      .insert(players)
      .values({
        accountHash: 'legacy-invalidation-account',
        displayName: 'LegacyInvalidationPlayer',
        displayNameLower: 'legacyinvalidationplayer',
        installSecretHash: 'legacy-incumbent-hash',
        updatedAt: new Date(),
      })
      .returning();
    const [candidate] = await db.insert(installRecoveryCandidates).values({
      playerId: player.id,
      incumbentSecretHash: 'legacy-incumbent-hash',
      candidateSecretHash: 'legacy-candidate-hash',
      status: 'invalidation_failed',
      displayName: 'LegacyInvalidationPlayer',
      payload: { zulrah: 80 },
      payloadDigest: 'legacy-payload-digest',
      receivedCount: 1,
      eligibleCount: 1,
      equalCount: 0,
      improvedCount: 0,
      newCount: 1,
      slowerCount: 0,
      missingCount: 0,
      firstSeenAt: new Date(),
      lastSeenAt: new Date(),
    }).returning();

    await expect(
      reopenRejectedInstallRecoveryCandidate(candidate.id, 'local-test-admin', 'Legacy recovery cleanup.')
    ).resolves.toMatchObject({ status: 'pending' });
  });
});

describe('database-authoritative successful replay', () => {
  const incumbentSecret = 'r'.repeat(20);
  const additionalSecret = 's'.repeat(20);
  const accountHash = 'replay-binding-account';
  const displayName = 'ReplayBindingPlayer';
  let cache: Map<string, unknown>;

  function syncRequest(installSecret: string, pbs: Record<string, number>) {
    return import('../src/app.js').then(({ app }) => app.request('/api/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountHash, displayName, installSecret, pbs }),
    }));
  }

  beforeEach(async () => {
    cache = new Map();
    mocks.get.mockReset();
    mocks.set.mockReset();
    mocks.expireTag.mockReset();
    mocks.get.mockImplementation(async (key: string) => cache.get(key) ?? null);
    mocks.set.mockImplementation(async (key: string, value: unknown) => {
      cache.set(key, value);
    });
    mocks.expireTag.mockResolvedValue(undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { truncateAll } = await import('./helpers.js');
    const { resetRateLimiter } = await import('../src/lib/secret.js');
    await truncateAll();
    resetRateLimiter();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function authorizeAndPrimeAdditionalReplay() {
    const { db } = await import('../src/db/client.js');
    const { playerInstallCredentials } = await import('../src/db/schema.js');
    const { promoteInstallRecoveryCandidate } = await import('../src/lib/installRecovery.js');
    const { eq } = await import('drizzle-orm');
    const { hashSecret } = await import('../src/lib/secret.js');

    expect((await syncRequest(incumbentSecret, { Zulrah: 80 })).status).toBe(200);
    const mismatch = await syncRequest(additionalSecret, { Zulrah: 75 });
    expect(mismatch.status).toBe(409);
    await promoteInstallRecoveryCandidate(
      (await mismatch.json()).recoveryId as number,
      'replay-test-admin',
      'Authorize replay race test machine.'
    );
    expect((await syncRequest(additionalSecret, { Zulrah: 74 })).status).toBe(200);

    const [credential] = await db
      .select()
      .from(playerInstallCredentials)
      .where(eq(playerInstallCredentials.secretHash, hashSecret(additionalSecret)));
    return credential;
  }

  it('rejects a cached success after revoke even when replay invalidation fails', async () => {
    const credential = await authorizeAndPrimeAdditionalReplay();
    const { revokePlayerInstallCredential } = await import('../src/lib/installRecovery.js');
    mocks.expireTag.mockRejectedValueOnce(new Error('cache outage'));

    await revokePlayerInstallCredential(
      credential.id,
      'replay-test-admin',
      'Revoke while cache invalidation is unavailable.'
    );
    const retry = await syncRequest(additionalSecret, { Zulrah: 74 });
    expect(retry.status).toBe(409);
    expect(await retry.json()).toMatchObject({ code: 'RECOVERY_REJECTED', recoveryId: null });
  });

  it('rejects a replay written after revocation has already committed', async () => {
    const credential = await authorizeAndPrimeAdditionalReplay();
    const { revokePlayerInstallCredential } = await import('../src/lib/installRecovery.js');
    const {
      buildSyncReplayKey,
      rememberSuccessfulSync,
    } = await import('../src/lib/syncReplay.js');
    const { hashSecret } = await import('../src/lib/secret.js');
    const replayKey = buildSyncReplayKey({
      accountHash,
      displayName,
      secretHash: hashSecret(additionalSecret),
      entries: [['Zulrah', 74]],
    });
    const cached = cache.get(replayKey);
    expect(cached).toBeDefined();

    await revokePlayerInstallCredential(
      credential.id,
      'replay-test-admin',
      'Commit revoke before a late replay write.'
    );
    cache.delete(replayKey);
    await rememberSuccessfulSync(replayKey, cached as { playerId: number; received: number });

    const retry = await syncRequest(additionalSecret, { Zulrah: 74 });
    expect(retry.status).toBe(409);
    expect(await retry.json()).toMatchObject({ code: 'RECOVERY_REJECTED', recoveryId: null });
  });

  it('still deduplicates replay for an active credential', async () => {
    await authorizeAndPrimeAdditionalReplay();

    const replay = await syncRequest(additionalSecret, { Zulrah: 74 });
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ ok: true, deduplicated: true, updated: 0 });
  });

  it('allows a cached replay again only after explicit reactivation', async () => {
    const credential = await authorizeAndPrimeAdditionalReplay();
    const {
      reactivatePlayerInstallCredential,
      revokePlayerInstallCredential,
    } = await import('../src/lib/installRecovery.js');
    mocks.expireTag.mockRejectedValue(new Error('cache outage'));

    await revokePlayerInstallCredential(
      credential.id,
      'replay-test-admin',
      'Temporarily revoke cached machine.'
    );
    expect((await syncRequest(additionalSecret, { Zulrah: 74 })).status).toBe(409);
    await reactivatePlayerInstallCredential(
      credential.id,
      'replay-test-admin',
      'Explicitly restore cached machine.'
    );

    const replay = await syncRequest(additionalSecret, { Zulrah: 74 });
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ ok: true, deduplicated: true });
  });
});
