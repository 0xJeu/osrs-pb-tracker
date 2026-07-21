import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../src/db/client.js';
import { installRecoveryCandidates } from '../src/db/schema.js';
import {
  cleanupInstallRecoveryE2eFixture,
  runInstallRecoveryE2e,
} from '../scripts/lib/install-recovery-e2e.js';
import { truncateAll } from './helpers.js';

describe('seeded staging install recovery E2E harness', () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it('verifies the full credential handoff without reporting secrets, hashes, or payloads', async () => {
    const report = await runInstallRecoveryE2e();

    expect(report.steps.map((step) => step.name)).toEqual([
      'incumbent_accepted',
      'mismatch_quarantined',
      'safe_metadata_visible',
      'candidate_promoted',
      'candidate_accepted',
      'former_incumbent_rejected',
    ]);
    expect(report.checks).toEqual({
      canonicalUnchangedBeforePromotion: true,
      quarantinedPayloadAppliedOnPromotion: true,
      promotedCandidateAccepted: true,
      formerIncumbentCouldNotWrite: true,
      auditSequenceVerified: true,
      sensitiveRecoveryDataExposed: false,
    });

    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain('staging-recovery-incumbent-0xsteph');
    expect(serialized).not.toContain('staging-recovery-candidate-0xsteph');
    expect(serialized).not.toContain('incumbentSecretHash');
    expect(serialized).not.toContain('candidateSecretHash');
    expect(serialized).not.toContain('payloadDigest');
    expect(serialized).not.toContain('"payload"');

    const candidates = await db
      .select({ status: installRecoveryCandidates.status })
      .from(installRecoveryCandidates)
      .orderBy(installRecoveryCandidates.id);
    expect(candidates).toEqual([{ status: 'promoted' }, { status: 'pending' }]);

    await cleanupInstallRecoveryE2eFixture();
    const remaining = await db
      .select({ id: installRecoveryCandidates.id })
      .from(installRecoveryCandidates)
      .where(eq(installRecoveryCandidates.displayName, '0xSteph Recovery E2E'));
    expect(remaining).toEqual([]);
  });
});
