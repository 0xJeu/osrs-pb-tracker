import { describe, expect, it } from 'vitest';
import { assessInstallRecovery } from '../src/lib/recoveryAssessment.js';

const base = {
  status: 'pending',
  attemptCount: 1,
  eligibleCount: 3,
  equalCount: 1,
  improvedCount: 1,
  newCount: 1,
  slowerCount: 0,
  missingCount: 0,
  firstSeenAt: new Date('2026-07-21T20:00:00Z'),
  lastSeenAt: new Date('2026-07-21T20:00:00Z'),
};

describe('install recovery assessment', () => {
  it('explains a strong but single-observation candidate conservatively', () => {
    const assessment = assessInstallRecovery(base, new Date('2026-07-20T20:00:00Z'));

    expect(assessment.why.code).toBe('INSTALL_CREDENTIAL_MISMATCH');
    expect(assessment.continuity).toMatchObject({
      level: 'strong',
      coveragePercent: 100,
      overlapCount: 2,
      storedCount: 2,
    });
    expect(assessment.recommendation).toMatchObject({
      action: 'verify_or_wait',
      tone: 'caution',
    });
    expect(assessment.promotionEffect).toMatchObject({ wouldChangeCount: 2 });
    expect(assessment.signals.map((signal) => signal.label)).toContain('No credential contest detected');
  });

  it('recommends contextual promotion only after repeated strong observations', () => {
    const assessment = assessInstallRecovery(
      {
        ...base,
        attemptCount: 3,
        lastSeenAt: new Date('2026-07-22T20:00:00Z'),
      },
      null
    );

    expect(assessment.recommendation.action).toBe('verify_then_promote');
    expect(assessment.recommendation.tone).toBe('positive');
  });

  it('never recommends promotion for a contested credential', () => {
    const assessment = assessInstallRecovery({ ...base, status: 'contested', attemptCount: 4 }, null);

    expect(assessment.recommendation).toMatchObject({
      action: 'do_not_promote',
      tone: 'danger',
    });
    expect(assessment.signals.map((signal) => signal.label)).toContain(
      'Credential activity is contested'
    );
  });

  it('marks incomplete or conflicting continuity for investigation', () => {
    const assessment = assessInstallRecovery(
      {
        ...base,
        attemptCount: 3,
        equalCount: 0,
        improvedCount: 1,
        slowerCount: 2,
        missingCount: 4,
      },
      null
    );

    expect(assessment.continuity.level).toBe('weak');
    expect(assessment.recommendation.action).toBe('investigate');
  });
});
