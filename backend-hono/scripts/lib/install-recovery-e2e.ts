import { asc, eq } from 'drizzle-orm';
import { app } from '../../src/app.js';
import { db } from '../../src/db/client.js';
import {
  installRecoveryCandidates,
  installRecoveryEvents,
  personalBests,
  players,
  syncAttempts,
} from '../../src/db/schema.js';
import {
  getSafeInstallRecoveryCandidate,
  promoteInstallRecoveryCandidate,
} from '../../src/lib/installRecovery.js';
import { resetRateLimiter } from '../../src/lib/secret.js';

const FIXTURE_ACCOUNT_HASH = 'staging-recovery-e2e-0xsteph';
const FIXTURE_DISPLAY_NAME = '0xSteph Recovery E2E';

// Intentionally synthetic staging credentials. They are used only as request
// inputs and must never be copied into the report returned by this harness.
const INCUMBENT_SECRET = 'staging-recovery-incumbent-0xsteph';
const CANDIDATE_SECRET = 'staging-recovery-candidate-0xsteph';

const INCUMBENT_PBS = { Zulrah: 80, Vorkath: 70 } as const;
const CANDIDATE_PBS = {
  Zulrah: 75,
  Vorkath: 70,
  Araxxor: 100,
  // Deliberately ineligible. It proves continuity metadata distinguishes raw
  // received entries from the normalized, tracked payload.
  'Dagannoth Prime': 50,
} as const;

const SAFE_METADATA_KEYS = [
  'attemptCount',
  'activeInstallCount',
  'displayName',
  'eligibleCount',
  'equalCount',
  'firstSeenAt',
  'id',
  'improvedCount',
  'installations',
  'lastSeenAt',
  'missingCount',
  'newCount',
  'playerId',
  'promotedAt',
  'receivedCount',
  'rejectedAt',
  'slowerCount',
  'status',
] as const;

type JsonObject = Record<string, unknown>;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`Install recovery E2E failed: ${message}`);
  }
}

async function readJson(response: Response): Promise<JsonObject> {
  return (await response.json()) as JsonObject;
}

async function sync(installSecret: string, pbs: Record<string, number>) {
  return app.request('/api/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      accountHash: FIXTURE_ACCOUNT_HASH,
      displayName: FIXTURE_DISPLAY_NAME,
      installSecret,
      pbs,
    }),
  });
}

async function canonicalPbs(playerId: number) {
  const rows = await db
    .select({ boss: personalBests.boss, timeSeconds: personalBests.timeSeconds })
    .from(personalBests)
    .where(eq(personalBests.playerId, playerId))
    .orderBy(asc(personalBests.boss));
  return new Map(rows.map((row) => [row.boss, row.timeSeconds]));
}

function assertCanonical(
  canonical: Map<string, number>,
  expected: Record<string, number>,
  stage: string
) {
  assert(canonical.size === Object.keys(expected).length, `${stage} canonical PB count changed`);
  for (const [boss, timeSeconds] of Object.entries(expected)) {
    assert(canonical.get(boss) === timeSeconds, `${stage} canonical PB value changed`);
  }
}

export async function cleanupInstallRecoveryE2eFixture() {
  assert(FIXTURE_ACCOUNT_HASH.startsWith('staging-'), 'fixture account hash is not staging-scoped');
  await db.delete(players).where(eq(players.accountHash, FIXTURE_ACCOUNT_HASH));
}

/**
 * Runs the real sync route and operator authorization path end to end. The caller
 * must perform the database target guard before invoking this write-enabled
 * harness outside Vitest. Returned data is deliberately allowlisted and never
 * contains credential hashes, install secrets, PB payloads, or payload digests.
 */
export async function runInstallRecoveryE2e() {
  assert(FIXTURE_ACCOUNT_HASH.startsWith('staging-'), 'fixture account hash is not staging-scoped');
  await cleanupInstallRecoveryE2eFixture();
  resetRateLimiter();

  const incumbentResponse = await sync(INCUMBENT_SECRET, INCUMBENT_PBS);
  const incumbentBody = await readJson(incumbentResponse);
  assert(incumbentResponse.status === 200, 'incumbent sync was not accepted');
  assert(incumbentBody.ok === true, 'incumbent response was not successful');
  const playerId = incumbentBody.playerId;
  assert(typeof playerId === 'number', 'incumbent response did not include a player ID');

  const mismatchResponse = await sync(CANDIDATE_SECRET, CANDIDATE_PBS);
  const mismatchBody = await readJson(mismatchResponse);
  assert(mismatchResponse.status === 409, 'mismatched credential was not rejected');
  assert(mismatchBody.code === 'RECOVERY_PENDING', 'mismatch was not quarantined as pending');
  const recoveryId = mismatchBody.recoveryId;
  assert(typeof recoveryId === 'number', 'mismatch response did not include a recovery ID');

  const pendingMetadata = await getSafeInstallRecoveryCandidate(recoveryId);
  assert(pendingMetadata !== null, 'safe candidate metadata was not queryable');
  assert(
    JSON.stringify(Object.keys(pendingMetadata).sort()) === JSON.stringify([...SAFE_METADATA_KEYS].sort()),
    'safe candidate metadata projection changed'
  );
  assert(pendingMetadata.status === 'pending', 'candidate metadata was not pending');
  assert(pendingMetadata.receivedCount === 4, 'candidate received count was incorrect');
  assert(pendingMetadata.eligibleCount === 3, 'candidate eligible count was incorrect');
  assert(pendingMetadata.equalCount === 1, 'candidate equal count was incorrect');
  assert(pendingMetadata.improvedCount === 1, 'candidate improved count was incorrect');
  assert(pendingMetadata.newCount === 1, 'candidate new count was incorrect');
  assert(pendingMetadata.slowerCount === 0, 'candidate slower count was incorrect');
  assert(pendingMetadata.missingCount === 0, 'candidate missing count was incorrect');
  assert(pendingMetadata.activeInstallCount === 1, 'active install count was incorrect');
  assert(pendingMetadata.installations.length === 1, 'safe install evidence was missing');

  const beforeAuthorization = await canonicalPbs(playerId);
  assertCanonical(beforeAuthorization, { zulrah: 80, vorkath: 70 }, 'pre-authorization');

  const promotion = await promoteInstallRecoveryCandidate(
    recoveryId,
    '0xSteph',
    'Seeded staging install recovery E2E verification.'
  );
  assert(promotion.candidateId === recoveryId, 'the exact candidate was not authorized');
  assert(promotion.mode === 'additional', 'candidate was not authorized additively');
  assert(promotion.changedBosses.length === 0, 'authorization applied quarantined PB data');

  const promotedMetadata = await getSafeInstallRecoveryCandidate(recoveryId);
  assert(promotedMetadata?.status === 'promoted', 'candidate metadata did not show promotion');
  assert(promotedMetadata.promotedAt instanceof Date, 'candidate promotion timestamp was missing');

  assert(promotedMetadata?.activeInstallCount === 2, 'second install was not active');
  const afterPromotion = await canonicalPbs(playerId);
  assertCanonical(
    afterPromotion,
    { vorkath: 70, zulrah: 80 },
    'post-authorization'
  );

  const candidateRetryResponse = await sync(CANDIDATE_SECRET, { Zulrah: 74, Araxxor: 99 });
  const candidateRetryBody = await readJson(candidateRetryResponse);
  assert(candidateRetryResponse.status === 200, 'promoted candidate was not accepted');
  assert(candidateRetryBody.ok === true, 'promoted candidate response was not successful');
  assert(candidateRetryBody.updated === 2, 'authorized candidate PB was not applied normally');

  const incumbentRetryResponse = await sync(INCUMBENT_SECRET, { Vorkath: 69 });
  const incumbentRetryBody = await readJson(incumbentRetryResponse);
  assert(incumbentRetryResponse.status === 200, 'original authorized install stopped working');
  assert(incumbentRetryBody.ok === true, 'original authorized install response was not successful');

  const finalCanonical = await canonicalPbs(playerId);
  assertCanonical(finalCanonical, { araxxor: 99, vorkath: 69, zulrah: 74 }, 'final');

  const [promotionEvent] = await db
    .select({ eventType: installRecoveryEvents.eventType, actor: installRecoveryEvents.actor })
    .from(installRecoveryEvents)
    .where(eq(installRecoveryEvents.candidateId, recoveryId));
  assert(promotionEvent?.eventType === 'authorized_additional', 'authorization event was not recorded');
  assert(promotionEvent.actor === '0xSteph', 'authorization actor was not recorded');

  const attempts = await db
    .select({ outcome: syncAttempts.outcome, httpStatus: syncAttempts.httpStatus })
    .from(syncAttempts)
    .where(eq(syncAttempts.playerId, playerId))
    .orderBy(asc(syncAttempts.id));
  assert(
    JSON.stringify(attempts) ===
      JSON.stringify([
        { outcome: 'accepted', httpStatus: 200 },
        { outcome: 'install_secret_mismatch', httpStatus: 409 },
        { outcome: 'accepted', httpStatus: 200 },
        { outcome: 'accepted', httpStatus: 200 },
      ]),
    'sync audit trail did not match the recovery sequence'
  );

  const finalCandidates = await db
    .select({ id: installRecoveryCandidates.id, status: installRecoveryCandidates.status })
    .from(installRecoveryCandidates)
    .where(eq(installRecoveryCandidates.playerId, playerId))
    .orderBy(asc(installRecoveryCandidates.id));
  assert(
    JSON.stringify(finalCandidates) ===
      JSON.stringify([{ id: recoveryId, status: 'promoted' }]),
    'unexpected recovery candidates were created after additive authorization'
  );

  return {
    fixture: { displayName: FIXTURE_DISPLAY_NAME },
    steps: [
      { name: 'incumbent_accepted', httpStatus: incumbentResponse.status },
      {
        name: 'mismatch_quarantined',
        httpStatus: mismatchResponse.status,
        code: mismatchBody.code,
        recoveryId,
      },
      { name: 'safe_metadata_visible', candidate: pendingMetadata },
      {
        name: 'candidate_authorized_additional',
        recoveryId,
        changedPbCount: promotion.changedBosses.length,
      },
      {
        name: 'candidate_accepted',
        httpStatus: candidateRetryResponse.status,
        updatedPbCount: candidateRetryBody.updated,
      },
      {
        name: 'original_install_still_accepted',
        httpStatus: incumbentRetryResponse.status,
      },
    ],
    checks: {
      canonicalUnchangedBeforeAuthorization: true,
      quarantinedSubmissionNotAppliedOnAuthorization: true,
      authorizedCandidateAccepted: true,
      originalInstallStillAccepted: true,
      auditSequenceVerified: true,
      sensitiveRecoveryDataExposed: false,
    },
  } as const;
}
