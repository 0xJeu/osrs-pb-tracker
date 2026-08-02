import { beforeEach, describe, expect, it } from 'vitest';
import { asc, eq } from 'drizzle-orm';
import { app } from '../src/app.js';
import { db } from '../src/db/client.js';
import {
  installRecoveryCandidates,
  installRecoveryEvents,
  personalBests,
  playerInstallCredentialEvents,
  playerInstallCredentials,
  players,
  syncAttempts,
} from '../src/db/schema.js';
import {
  promoteInstallRecoveryCandidate,
  pruneExpiredInstallRecoveryCandidates,
  reactivatePlayerInstallCredential,
  RecoveryDecisionConflictError,
  rejectInstallRecoveryCandidate,
  revokePlayerInstallCredential,
} from '../src/lib/installRecovery.js';
import { hashSecret, resetRateLimiter } from '../src/lib/secret.js';
import { resetSyncReplayCache } from '../src/lib/syncReplay.js';
import { commitExistingAuthorizedSync } from '../src/routes/sync.js';
import { truncateAll } from './helpers.js';

const incumbentSecret = 'a'.repeat(20);
const candidateSecret = 'b'.repeat(20);

function syncRequest(installSecret: string, pbs: Record<string, number>) {
  return syncForAccount('recovery-account', '0xSteph Recovery', installSecret, pbs);
}

function syncForAccount(
  accountHash: string,
  displayName: string,
  installSecret: string,
  pbs: Record<string, number>
) {
  return app.request('/api/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      accountHash,
      displayName,
      installSecret,
      pbs,
    }),
  });
}

async function establishIncumbent() {
  const response = await syncRequest(incumbentSecret, { Zulrah: 80, Vorkath: 70 });
  expect(response.status).toBe(200);
  return response;
}

describe('install credential recovery', () => {
  beforeEach(async () => {
    await resetSyncReplayCache();
    await truncateAll();
    resetRateLimiter();
  });

  it('captures and quarantines a mismatched install without changing canonical PBs', async () => {
    await establishIncumbent();

    const mismatch = await syncRequest(candidateSecret, {
      Zulrah: 75,
      Vorkath: 70,
      Araxxor: 100,
      'Dagannoth Prime': 50,
    });

    expect(mismatch.status).toBe(409);
    const body = await mismatch.json();
    expect(body).toMatchObject({
      code: 'RECOVERY_PENDING',
      recoveryId: expect.any(Number),
      retryAfterSeconds: 900,
    });

    const [candidate] = await db.select().from(installRecoveryCandidates);
    expect(candidate).toMatchObject({
      id: body.recoveryId,
      status: 'pending',
      incumbentSecretHash: hashSecret(incumbentSecret),
      candidateSecretHash: hashSecret(candidateSecret),
      attemptCount: 1,
      receivedCount: 4,
      eligibleCount: 3,
      equalCount: 1,
      improvedCount: 1,
      newCount: 1,
      slowerCount: 0,
      missingCount: 0,
      payload: { araxxor: 100, vorkath: 70, zulrah: 75 },
    });

    const canonical = await db
      .select({ boss: personalBests.boss, timeSeconds: personalBests.timeSeconds })
      .from(personalBests)
      .orderBy(asc(personalBests.boss));
    expect(canonical).toEqual([
      { boss: 'vorkath', timeSeconds: 70 },
      { boss: 'zulrah', timeSeconds: 80 },
    ]);

    const attempts = await db.select().from(syncAttempts).orderBy(asc(syncAttempts.id));
    expect(attempts[1]).toMatchObject({
      outcome: 'install_secret_mismatch',
      recoveryCandidateId: candidate.id,
      receivedCount: 4,
      eligibleCount: 3,
      updatedCount: null,
    });
  });

  it('updates one stable candidate instead of creating duplicate recovery rows', async () => {
    await establishIncumbent();
    await syncRequest(candidateSecret, { Zulrah: 75, Vorkath: 70 });
    await syncRequest(candidateSecret, { Zulrah: 74, Vorkath: 70 });

    const candidates = await db.select().from(installRecoveryCandidates);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      status: 'pending',
      attemptCount: 2,
      improvedCount: 1,
      equalCount: 1,
      payload: { vorkath: 70, zulrah: 74 },
    });
  });

  it('marks competing credentials contested and does not treat a request storm as approval', async () => {
    await establishIncumbent();
    const first = await syncRequest(candidateSecret, { Zulrah: 75 });
    expect((await first.json()).code).toBe('RECOVERY_PENDING');

    const second = await syncRequest('c'.repeat(20), { Zulrah: 75 });
    expect((await second.json()).code).toBe('RECOVERY_CONTESTED');

    const candidates = await db
      .select({ status: installRecoveryCandidates.status })
      .from(installRecoveryCandidates)
      .orderBy(asc(installRecoveryCandidates.id));
    expect(candidates).toEqual([{ status: 'contested' }, { status: 'contested' }]);
  });

  it('serializes concurrent competing candidate capture per player', async () => {
    await establishIncumbent();

    await Promise.all([
      syncRequest(candidateSecret, { Zulrah: 75 }),
      syncRequest('c'.repeat(20), { Zulrah: 74 }),
    ]);

    const candidates = await db
      .select({ status: installRecoveryCandidates.status })
      .from(installRecoveryCandidates)
      .orderBy(asc(installRecoveryCandidates.id));
    expect(candidates).toEqual([{ status: 'contested' }, { status: 'contested' }]);
  });

  it('caps candidates within one credential epoch', async () => {
    await establishIncumbent();

    for (const character of ['b', 'c', 'd', 'e', 'f']) {
      expect((await syncRequest(character.repeat(20), { Zulrah: 75 })).status).toBe(409);
    }
    const capped = await syncRequest('g'.repeat(20), { Zulrah: 74 });

    expect(await capped.json()).toMatchObject({
      code: 'INSTALL_SECRET_MISMATCH',
      recoveryId: null,
    });
    expect(await db.select().from(installRecoveryCandidates)).toHaveLength(5);
  });

  it('allows a new active candidate after an older candidate is rejected', async () => {
    await establishIncumbent();
    for (const character of ['b', 'c', 'd', 'e', 'f']) {
      await syncRequest(character.repeat(20), { Zulrah: 75 });
    }
    const candidates = await db
      .select({ id: installRecoveryCandidates.id })
      .from(installRecoveryCandidates)
      .orderBy(asc(installRecoveryCandidates.id));
    await rejectInstallRecoveryCandidate(candidates[0].id, 'local-test-admin');

    const replacement = await syncRequest('g'.repeat(20), { Zulrah: 74 });

    expect(await replacement.json()).toMatchObject({
      code: 'RECOVERY_CONTESTED',
      recoveryId: expect.any(Number),
    });
    expect(await db.select().from(installRecoveryCandidates)).toHaveLength(6);
  });

  it('prunes recovery candidates after the retention window', async () => {
    await establishIncumbent();
    await syncRequest(candidateSecret, { Zulrah: 75 });
    await db
      .update(installRecoveryCandidates)
      .set({ lastSeenAt: new Date(Date.now() - 91 * 24 * 60 * 60 * 1000) });

    await pruneExpiredInstallRecoveryCandidates(100);

    expect(await db.select().from(installRecoveryCandidates)).toHaveLength(0);
  });

  it('keeps a pending candidate unopposed when an authorized machine returns', async () => {
    await establishIncumbent();
    await syncRequest(candidateSecret, { Zulrah: 75 });

    const incumbent = await syncRequest(incumbentSecret, { Zulrah: 79 });
    expect(incumbent.status).toBe(200);

    const [candidate] = await db.select().from(installRecoveryCandidates);
    expect(candidate.status).toBe('pending');
    expect(await db.select().from(installRecoveryEvents)).toHaveLength(0);
  });

  it('keeps a pending candidate unopposed when an authorized machine replays cached data', async () => {
    await establishIncumbent();
    await syncRequest(candidateSecret, { Zulrah: 75 });

    const replayedIncumbent = await syncRequest(incumbentSecret, { Zulrah: 80, Vorkath: 70 });
    expect(replayedIncumbent.status).toBe(200);

    const [candidate] = await db.select().from(installRecoveryCandidates);
    expect(candidate.status).toBe('pending');
  });

  it('keeps the original machine authorized after approving an additional machine', async () => {
    await establishIncumbent();
    const mismatch = await syncRequest(candidateSecret, { Zulrah: 75, Vorkath: 70, Araxxor: 100 });
    const recoveryId = (await mismatch.json()).recoveryId as number;

    await promoteInstallRecoveryCandidate(recoveryId, 'local-test-admin', 'Regression test for promotion.');

    const incumbentReplay = await syncRequest(incumbentSecret, { Zulrah: 80, Vorkath: 70 });
    expect(incumbentReplay.status).toBe(200);
    expect(
      await db.select().from(playerInstallCredentials).where(eq(playerInstallCredentials.status, 'active'))
    ).toHaveLength(2);
  });

  it('only invalidates the affected player\'s replay cache, not every player\'s', async () => {
    await establishIncumbent();

    const otherPlayerSecret = 'd'.repeat(20);
    const otherPlayerResponse = await app.request('/api/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accountHash: 'unrelated-account',
        displayName: 'Unrelated Player',
        installSecret: otherPlayerSecret,
        pbs: { Zulrah: 90 },
      }),
    });
    expect(otherPlayerResponse.status).toBe(200);

    // Creates a candidate for the *first* account only.
    await syncRequest(candidateSecret, { Zulrah: 75 });

    // The unrelated player's identical, already-cached sync must still be
    // served from the replay cache - a public caller submitting a mismatched
    // install secret for one account must not be able to evict every other
    // player's replay protection and defeat the sync-storm load shedder.
    const otherPlayerReplay = await app.request('/api/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accountHash: 'unrelated-account',
        displayName: 'Unrelated Player',
        installSecret: otherPlayerSecret,
        pbs: { Zulrah: 90 },
      }),
    });
    expect(otherPlayerReplay.status).toBe(200);
    expect(await otherPlayerReplay.json()).toMatchObject({ deduplicated: true });
  });

  it('authorizes the exact pending credential without applying its quarantined payload', async () => {
    await establishIncumbent();
    const mismatch = await syncRequest(candidateSecret, { Zulrah: 75, Vorkath: 75, Araxxor: 100 });
    const recoveryId = (await mismatch.json()).recoveryId as number;

    const promoted = await promoteInstallRecoveryCandidate(
      recoveryId,
      'local-test-admin',
      'Exercise the locally testable recovery flow.'
    );
    expect(promoted).toMatchObject({
      candidateId: recoveryId,
      changedBosses: [],
      mode: 'additional',
      revokedInstallCount: 0,
    });

    const [player] = await db.select().from(players);
    expect(player.installSecretHash).toBe(hashSecret(incumbentSecret));
    expect(await db.select().from(playerInstallCredentials)).toHaveLength(2);
    const canonical = await db
      .select({ boss: personalBests.boss, timeSeconds: personalBests.timeSeconds })
      .from(personalBests)
      .orderBy(asc(personalBests.boss));
    expect(canonical).toEqual([
      { boss: 'vorkath', timeSeconds: 70 },
      { boss: 'zulrah', timeSeconds: 80 },
    ]);

    const [candidate] = await db.select().from(installRecoveryCandidates);
    expect(candidate.status).toBe('promoted');
    const [event] = await db.select().from(installRecoveryEvents);
    expect(event).toMatchObject({
      candidateId: recoveryId,
      eventType: 'authorized_additional',
      actor: 'local-test-admin',
    });

    const accepted = await syncRequest(candidateSecret, { Zulrah: 74, Araxxor: 99 });
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toMatchObject({ ok: true, updated: 2 });

    await expect(
      promoteInstallRecoveryCandidate(recoveryId, 'local-test-admin')
    ).rejects.toBeInstanceOf(RecoveryDecisionConflictError);
  });

  it('serializes simultaneous promote and reject decisions', async () => {
    await establishIncumbent();
    const mismatch = await syncRequest(candidateSecret, { Zulrah: 75 });
    const recoveryId = (await mismatch.json()).recoveryId as number;

    const decisions = await Promise.allSettled([
      promoteInstallRecoveryCandidate(recoveryId, 'promoting-admin'),
      rejectInstallRecoveryCandidate(recoveryId, 'rejecting-admin'),
    ]);

    expect(decisions.filter((decision) => decision.status === 'fulfilled')).toHaveLength(1);
    expect(decisions.filter((decision) => decision.status === 'rejected')).toHaveLength(1);
    const [candidate] = await db.select().from(installRecoveryCandidates);
    const [player] = await db.select().from(players);
    const [event] = await db.select().from(installRecoveryEvents);
    if (candidate.status === 'promoted') {
      expect(player.installSecretHash).toBe(hashSecret(incumbentSecret));
      expect(event.eventType).toBe('authorized_additional');
      expect(event.actor).toBe('promoting-admin');
    } else {
      expect(candidate.status).toBe('rejected');
      expect(event.eventType).toBe('rejected');
      expect(player.installSecretHash).toBe(hashSecret(incumbentSecret));
      expect(event.actor).toBe('rejecting-admin');
    }
  });

  it('rejects a candidate without changing the incumbent credential or PBs', async () => {
    await establishIncumbent();
    const mismatch = await syncRequest(candidateSecret, { Zulrah: 75 });
    const recoveryId = (await mismatch.json()).recoveryId as number;

    await rejectInstallRecoveryCandidate(recoveryId, 'local-test-admin', 'Deliberate local rejection test.');

    const [player] = await db.select().from(players);
    expect(player.installSecretHash).toBe(hashSecret(incumbentSecret));
    const [zulrah] = await db
      .select({ timeSeconds: personalBests.timeSeconds })
      .from(personalBests)
      .where(eq(personalBests.boss, 'zulrah'));
    expect(zulrah.timeSeconds).toBe(80);

    const retried = await syncRequest(candidateSecret, { Zulrah: 74 });
    expect(await retried.json()).toMatchObject({
      code: 'RECOVERY_REJECTED',
      recoveryId,
    });

    const [candidate] = await db.select().from(installRecoveryCandidates);
    expect(candidate).toMatchObject({ status: 'rejected', attemptCount: 2 });
    const [event] = await db.select().from(installRecoveryEvents);
    expect(event).toMatchObject({ eventType: 'rejected', actor: 'local-test-admin' });
  });

  it('does not let a rejected credential contest a different pending candidate', async () => {
    await establishIncumbent();
    const rejectedMismatch = await syncRequest(candidateSecret, { Zulrah: 75 });
    const rejectedId = (await rejectedMismatch.json()).recoveryId as number;
    await rejectInstallRecoveryCandidate(rejectedId, 'local-test-admin');

    const pendingMismatch = await syncRequest('c'.repeat(20), { Zulrah: 74 });
    const pendingId = (await pendingMismatch.json()).recoveryId as number;
    const rejectedRetry = await syncRequest(candidateSecret, { Zulrah: 73 });
    expect(await rejectedRetry.json()).toMatchObject({
      code: 'RECOVERY_REJECTED',
      recoveryId: rejectedId,
    });

    const candidates = await db
      .select({ id: installRecoveryCandidates.id, status: installRecoveryCandidates.status })
      .from(installRecoveryCandidates)
      .orderBy(asc(installRecoveryCandidates.id));
    expect(candidates).toEqual([
      { id: rejectedId, status: 'rejected' },
      { id: pendingId, status: 'pending' },
    ]);
  });

  it('starts a new recovery epoch when a rejected install returns after the incumbent changes', async () => {
    await establishIncumbent();
    const rejectedMismatch = await syncRequest(candidateSecret, { Zulrah: 75 });
    const rejectedId = (await rejectedMismatch.json()).recoveryId as number;
    await rejectInstallRecoveryCandidate(rejectedId, 'local-test-admin');

    const replacementMismatch = await syncRequest('c'.repeat(20), { Zulrah: 74 });
    const replacementId = (await replacementMismatch.json()).recoveryId as number;
    await promoteInstallRecoveryCandidate(replacementId, 'local-test-admin', undefined, 'replace');

    const returnedInstall = await syncRequest(candidateSecret, { Zulrah: 73 });
    const body = await returnedInstall.json();
    expect(body).toMatchObject({
      code: 'RECOVERY_PENDING',
      recoveryId: expect.any(Number),
    });
    expect(body.recoveryId).not.toBe(rejectedId);

    const candidateRows = await db
      .select({
        id: installRecoveryCandidates.id,
        status: installRecoveryCandidates.status,
        incumbentSecretHash: installRecoveryCandidates.incumbentSecretHash,
      })
      .from(installRecoveryCandidates)
      .where(eq(installRecoveryCandidates.candidateSecretHash, hashSecret(candidateSecret)))
      .orderBy(asc(installRecoveryCandidates.id));
    expect(candidateRows).toEqual([
      {
        id: rejectedId,
        status: 'rejected',
        incumbentSecretHash: hashSecret(incumbentSecret),
      },
      {
        id: body.recoveryId,
        status: 'pending',
        incumbentSecretHash: hashSecret('c'.repeat(20)),
      },
    ]);
  });

  it('refuses promotion if the incumbent binding changed after candidate capture', async () => {
    await establishIncumbent();
    const mismatch = await syncRequest(candidateSecret, { Zulrah: 75 });
    const recoveryId = (await mismatch.json()).recoveryId as number;
    await db
      .update(players)
      .set({ installSecretHash: hashSecret('c'.repeat(20)) })
      .where(eq(players.accountHash, 'recovery-account'));

    await expect(
      promoteInstallRecoveryCandidate(recoveryId, 'local-test-admin')
    ).rejects.toBeInstanceOf(RecoveryDecisionConflictError);

    const [candidate] = await db.select().from(installRecoveryCandidates);
    expect(candidate.status).toBe('pending');
    const [zulrah] = await db
      .select({ timeSeconds: personalBests.timeSeconds })
      .from(personalBests)
      .where(eq(personalBests.boss, 'zulrah'));
    expect(zulrah.timeSeconds).toBe(80);
  });

  it('rechecks candidate state after promotion waits for the player lock', async () => {
    const incumbent = await establishIncumbent();
    const { playerId } = await incumbent.json();
    const mismatch = await syncRequest(candidateSecret, { Zulrah: 75 });
    const recoveryId = (await mismatch.json()).recoveryId as number;

    const contestingTransaction = Promise.resolve(
      db.$client.transaction((txn) => [
        txn('SELECT id FROM players WHERE id = $1 FOR UPDATE', [playerId]),
        txn('SELECT pg_sleep(3)'),
        txn(
          `UPDATE install_recovery_candidates
           SET status = 'contested'
           WHERE id = $1`,
          [recoveryId]
        ),
      ])
    );
    await new Promise((resolve) => setTimeout(resolve, 1_000));

    const promotion = promoteInstallRecoveryCandidate(recoveryId, 'local-test-admin');
    await contestingTransaction;
    await expect(promotion).rejects.toBeInstanceOf(RecoveryDecisionConflictError);

    const [candidate] = await db.select().from(installRecoveryCandidates);
    const [player] = await db.select().from(players).where(eq(players.id, playerId));
    expect(candidate.status).toBe('contested');
    expect(player.installSecretHash).toBe(hashSecret(incumbentSecret));
  }, 15_000);

  it('allows machines A and B to alternate and lets the old machine return', async () => {
    const incumbent = await establishIncumbent();
    const { playerId } = await incumbent.json();
    const mismatch = await syncRequest(candidateSecret, { Zulrah: 75 });
    const recoveryId = (await mismatch.json()).recoveryId as number;

    await promoteInstallRecoveryCandidate(recoveryId, 'local-test-admin');
    expect((await syncRequest(candidateSecret, { Zulrah: 74 })).status).toBe(200);
    expect((await syncRequest(incumbentSecret, { Vorkath: 69 })).status).toBe(200);
    expect((await syncRequest(candidateSecret, { Zulrah: 73 })).status).toBe(200);
    expect((await syncRequest(incumbentSecret, { Vorkath: 68 })).status).toBe(200);

    const active = await db
      .select()
      .from(playerInstallCredentials)
      .where(eq(playerInstallCredentials.status, 'active'));
    expect(active).toHaveLength(2);
    expect(new Set(active.map((install) => install.secretHash))).toEqual(
      new Set([hashSecret(incumbentSecret), hashSecret(candidateSecret)])
    );
    expect(active.every((install) => install.playerId === playerId)).toBe(true);
  });

  it('rejects an in-flight commit after its individual installation is revoked', async () => {
    const incumbent = await establishIncumbent();
    const { playerId } = await incumbent.json();
    const mismatch = await syncRequest(candidateSecret, { Zulrah: 75 });
    await promoteInstallRecoveryCandidate((await mismatch.json()).recoveryId, 'local-test-admin');
    const [candidateInstall] = await db
      .select()
      .from(playerInstallCredentials)
      .where(eq(playerInstallCredentials.secretHash, hashSecret(candidateSecret)));
    await revokePlayerInstallCredential(candidateInstall.id, 'local-test-admin', 'Revoke test machine.');

    const staleCommit = await commitExistingAuthorizedSync({
      playerId,
      secretHash: hashSecret(candidateSecret),
      displayName: 'Revoked Machine Rename',
      displayNameLower: 'revoked machine rename',
      pbsByBoss: new Map([['zulrah', 1]]),
    });

    expect(staleCommit).toMatchObject({
      authorized: false,
      insertedBosses: [],
      improvedBosses: [],
    });
    const [player] = await db.select().from(players).where(eq(players.id, playerId));
    expect(player.displayName).toBe('0xSteph Recovery');
    const [zulrah] = await db
      .select({ timeSeconds: personalBests.timeSeconds })
      .from(personalBests)
      .where(eq(personalBests.boss, 'zulrah'));
    expect(zulrah.timeSeconds).toBe(80);
  });

  it('supports explicit revoke and reactivation without silently reauthorizing', async () => {
    await establishIncumbent();
    const mismatch = await syncRequest(candidateSecret, { Zulrah: 75 });
    const recoveryId = (await mismatch.json()).recoveryId as number;
    await promoteInstallRecoveryCandidate(recoveryId, 'local-test-admin');
    const [candidateInstall] = await db
      .select()
      .from(playerInstallCredentials)
      .where(eq(playerInstallCredentials.secretHash, hashSecret(candidateSecret)));

    await revokePlayerInstallCredential(candidateInstall.id, 'local-test-admin', 'Lost machine.');
    const [candidateBeforeRetry] = await db
      .select()
      .from(installRecoveryCandidates)
      .where(eq(installRecoveryCandidates.id, recoveryId));
    const rejectedRetry = await syncRequest(candidateSecret, { Zulrah: 74 });
    expect(rejectedRetry.status).toBe(409);
    expect(await rejectedRetry.json()).toMatchObject({
      code: 'RECOVERY_REJECTED',
      recoveryId: null,
    });
    const [revoked] = await db
      .select()
      .from(playerInstallCredentials)
      .where(eq(playerInstallCredentials.id, candidateInstall.id));
    expect(revoked.status).toBe('revoked');
    const [candidateAfterRetry] = await db
      .select()
      .from(installRecoveryCandidates)
      .where(eq(installRecoveryCandidates.id, recoveryId));
    expect(candidateAfterRetry.attemptCount).toBe(candidateBeforeRetry.attemptCount);
    expect(candidateAfterRetry.lastSeenAt.getTime()).toBe(candidateBeforeRetry.lastSeenAt.getTime());
    expect(candidateAfterRetry.status).toBe('rejected');
    const [zulrahBeforeReactivation] = await db
      .select({ timeSeconds: personalBests.timeSeconds })
      .from(personalBests)
      .where(eq(personalBests.boss, 'zulrah'));
    expect(zulrahBeforeReactivation.timeSeconds).toBe(80);

    await reactivatePlayerInstallCredential(candidateInstall.id, 'local-test-admin', 'Machine recovered.');
    expect((await syncRequest(candidateSecret, { Zulrah: 74 })).status).toBe(200);
    const events = await db
      .select({ eventType: playerInstallCredentialEvents.eventType })
      .from(playerInstallCredentialEvents)
      .where(eq(playerInstallCredentialEvents.credentialId, candidateInstall.id))
      .orderBy(playerInstallCredentialEvents.id);
    expect(events.map((event) => event.eventType)).toEqual([
      'authorized_additional',
      'revoked',
      'reactivated',
    ]);
  });

  it('keeps a revoked legacy-anchor installation dormant until explicit reactivation', async () => {
    await establishIncumbent();
    const mismatch = await syncRequest(candidateSecret, { Zulrah: 75 });
    await promoteInstallRecoveryCandidate((await mismatch.json()).recoveryId, 'local-test-admin');
    const [legacyInstall] = await db
      .select()
      .from(playerInstallCredentials)
      .where(eq(playerInstallCredentials.secretHash, hashSecret(incumbentSecret)));
    await revokePlayerInstallCredential(legacyInstall.id, 'local-test-admin', 'Legacy machine retired.');

    const candidatesBefore = await db.select().from(installRecoveryCandidates);
    const retry = await syncForAccount(
      'recovery-account',
      'Revoked Legacy Rename',
      incumbentSecret,
      { Zulrah: 1, Araxxor: 2 }
    );
    expect(retry.status).toBe(409);
    expect(await retry.json()).toMatchObject({ code: 'RECOVERY_REJECTED', recoveryId: null });
    expect(await db.select().from(installRecoveryCandidates)).toEqual(candidatesBefore);
    const [playerBeforeReactivation] = await db.select().from(players);
    expect(playerBeforeReactivation.displayName).toBe('0xSteph Recovery');
    const canonicalBeforeReactivation = await db
      .select({ boss: personalBests.boss, timeSeconds: personalBests.timeSeconds })
      .from(personalBests)
      .orderBy(asc(personalBests.boss));
    expect(canonicalBeforeReactivation).toEqual([
      { boss: 'vorkath', timeSeconds: 70 },
      { boss: 'zulrah', timeSeconds: 80 },
    ]);

    await reactivatePlayerInstallCredential(legacyInstall.id, 'local-test-admin', 'Legacy machine restored.');
    const restored = await syncForAccount(
      'recovery-account',
      'Revoked Legacy Rename',
      incumbentSecret,
      { Zulrah: 74 }
    );
    expect(restored.status).toBe(200);
    const [playerAfterReactivation] = await db.select().from(players);
    expect(playerAfterReactivation.displayName).toBe('Revoked Legacy Rename');
  });

  it('does not allow the last active installation to be revoked', async () => {
    await establishIncumbent();
    const [onlyInstall] = await db.select().from(playerInstallCredentials);
    await expect(
      revokePlayerInstallCredential(onlyInstall.id, 'local-test-admin', 'Must fail safely.')
    ).rejects.toBeInstanceOf(RecoveryDecisionConflictError);
  });

  it('supports an exceptional replace-all decision and invalidates former machines', async () => {
    await establishIncumbent();
    const mismatch = await syncRequest(candidateSecret, { Zulrah: 75 });
    const recoveryId = (await mismatch.json()).recoveryId as number;

    const replaced = await promoteInstallRecoveryCandidate(
      recoveryId,
      'local-test-admin',
      'Confirmed security replacement.',
      'replace'
    );
    expect(replaced).toMatchObject({ mode: 'replace', revokedInstallCount: 1 });
    expect((await syncRequest(incumbentSecret, { Zulrah: 70 })).status).toBe(409);
    expect((await syncRequest(candidateSecret, { Zulrah: 74 })).status).toBe(200);
    const installs = await db.select().from(playerInstallCredentials);
    expect(installs.filter((install) => install.status === 'active')).toHaveLength(1);
    expect(installs.filter((install) => install.status === 'revoked')).toHaveLength(1);
  });

  it('allows one RuneLite installation secret to serve multiple game accounts', async () => {
    const sharedInstall = 's'.repeat(20);
    expect((await syncForAccount('account-one', 'Account One', sharedInstall, { Zulrah: 80 })).status).toBe(200);
    expect((await syncForAccount('account-two', 'Account Two', sharedInstall, { Vorkath: 70 })).status).toBe(200);

    const installs = await db.select().from(playerInstallCredentials);
    expect(installs).toHaveLength(2);
    expect(new Set(installs.map((install) => install.playerId)).size).toBe(2);
    expect(new Set(installs.map((install) => install.secretHash))).toEqual(
      new Set([hashSecret(sharedInstall)])
    );
  });

  it('atomically chooses one winner when two first-install claims race', async () => {
    const responses = await Promise.all([
      syncForAccount('first-claim-race', 'Race Account', incumbentSecret, { Zulrah: 80 }),
      syncForAccount('first-claim-race', 'Race Account', candidateSecret, { Zulrah: 79 }),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    const [player] = await db.select().from(players);
    const installs = await db.select().from(playerInstallCredentials);
    const candidates = await db.select().from(installRecoveryCandidates);
    expect(installs).toHaveLength(1);
    expect(installs[0].playerId).toBe(player.id);
    expect(candidates).toHaveLength(1);
  });
});
