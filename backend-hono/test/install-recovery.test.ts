import { beforeEach, describe, expect, it } from 'vitest';
import { asc, eq } from 'drizzle-orm';
import { app } from '../src/app.js';
import { db } from '../src/db/client.js';
import {
  installRecoveryCandidates,
  installRecoveryEvents,
  personalBests,
  players,
  syncAttempts,
} from '../src/db/schema.js';
import {
  promoteInstallRecoveryCandidate,
  RecoveryDecisionConflictError,
  rejectInstallRecoveryCandidate,
} from '../src/lib/installRecovery.js';
import { hashSecret, resetRateLimiter } from '../src/lib/secret.js';
import { resetSyncReplayCache } from '../src/lib/syncReplay.js';
import { truncateAll } from './helpers.js';

const incumbentSecret = 'a'.repeat(20);
const candidateSecret = 'b'.repeat(20);

function syncRequest(installSecret: string, pbs: Record<string, number>) {
  return app.request('/api/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      accountHash: 'recovery-account',
      displayName: '0xSteph Recovery',
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

  it('marks a pending candidate contested when the incumbent credential returns', async () => {
    await establishIncumbent();
    await syncRequest(candidateSecret, { Zulrah: 75 });

    const incumbent = await syncRequest(incumbentSecret, { Zulrah: 79 });
    expect(incumbent.status).toBe(200);

    const [candidate] = await db.select().from(installRecoveryCandidates);
    expect(candidate.status).toBe('contested');
    const [event] = await db.select().from(installRecoveryEvents);
    expect(event).toMatchObject({
      candidateId: candidate.id,
      eventType: 'incumbent_seen',
      actor: 'system',
    });
  });

  it('promotes the exact pending credential and replays its quarantined faster-only payload', async () => {
    await establishIncumbent();
    const mismatch = await syncRequest(candidateSecret, { Zulrah: 75, Vorkath: 75, Araxxor: 100 });
    const recoveryId = (await mismatch.json()).recoveryId as number;

    const promoted = await promoteInstallRecoveryCandidate(
      recoveryId,
      'local-test-admin',
      'Exercise the locally testable recovery flow.'
    );
    expect(promoted).toMatchObject({ candidateId: recoveryId, changedBosses: ['zulrah', 'araxxor'] });

    const [player] = await db.select().from(players);
    expect(player.installSecretHash).toBe(hashSecret(candidateSecret));
    const canonical = await db
      .select({ boss: personalBests.boss, timeSeconds: personalBests.timeSeconds })
      .from(personalBests)
      .orderBy(asc(personalBests.boss));
    expect(canonical).toEqual([
      { boss: 'araxxor', timeSeconds: 100 },
      { boss: 'vorkath', timeSeconds: 70 },
      { boss: 'zulrah', timeSeconds: 75 },
    ]);

    const [candidate] = await db.select().from(installRecoveryCandidates);
    expect(candidate.status).toBe('promoted');
    const [event] = await db.select().from(installRecoveryEvents);
    expect(event).toMatchObject({
      candidateId: recoveryId,
      eventType: 'promoted',
      actor: 'local-test-admin',
    });

    const accepted = await syncRequest(candidateSecret, { Zulrah: 74 });
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toMatchObject({ ok: true, updated: 1 });

    await expect(
      promoteInstallRecoveryCandidate(recoveryId, 'local-test-admin')
    ).rejects.toBeInstanceOf(RecoveryDecisionConflictError);
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
    await promoteInstallRecoveryCandidate(replacementId, 'local-test-admin');

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
});
