export interface RecoveryAssessmentInput {
  status: string;
  attemptCount: number;
  eligibleCount: number;
  equalCount: number;
  improvedCount: number;
  newCount: number;
  slowerCount: number;
  missingCount: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
}

export type RecoverySignalTone = 'positive' | 'caution' | 'danger' | 'neutral';

export interface RecoverySignal {
  tone: RecoverySignalTone;
  label: string;
  detail: string;
}

function observationDetail(candidate: RecoveryAssessmentInput) {
  if (candidate.attemptCount === 1) {
    return 'This credential has been observed once. A single request is weak liveness evidence.';
  }
  const spanMinutes = Math.max(
    0,
    Math.round((candidate.lastSeenAt.getTime() - candidate.firstSeenAt.getTime()) / 60_000)
  );
  return `${candidate.attemptCount} requests used the same candidate credential across approximately ${spanMinutes} minute(s).`;
}

export function assessInstallRecovery(
  candidate: RecoveryAssessmentInput,
  lastAcceptedSyncAt: Date | null
) {
  const overlapCount = candidate.equalCount + candidate.improvedCount + candidate.slowerCount;
  const storedCount = overlapCount + candidate.missingCount;
  const coveragePercent = storedCount === 0 ? 0 : Math.round((overlapCount / storedCount) * 100);
  const wouldChangeCount = candidate.improvedCount + candidate.newCount;
  const continuity =
    storedCount > 0 && coveragePercent >= 80 && candidate.slowerCount === 0
      ? 'strong'
      : storedCount > 0 && coveragePercent >= 50
        ? 'mixed'
        : 'weak';

  const signals: RecoverySignal[] = [
    {
      tone: 'caution',
      label: 'Different install credential',
      detail:
        'The account identifier already belongs to another install credential, so this sync was quarantined instead of changing public data.',
    },
    {
      tone: candidate.attemptCount >= 2 ? 'positive' : 'caution',
      label: `${candidate.attemptCount} candidate observation${candidate.attemptCount === 1 ? '' : 's'}`,
      detail: observationDetail(candidate),
    },
    {
      tone: continuity === 'strong' ? 'positive' : continuity === 'mixed' ? 'caution' : 'danger',
      label: `${coveragePercent}% existing-PB coverage`,
      detail:
        storedCount === 0
          ? 'There are no stored PBs available for continuity comparison.'
          : `${overlapCount} of ${storedCount} stored PBs were present: ${candidate.equalCount} equal, ${candidate.improvedCount} faster, and ${candidate.slowerCount} slower.`,
    },
    {
      tone: candidate.missingCount === 0 ? 'positive' : 'caution',
      label: `${candidate.missingCount} stored PB${candidate.missingCount === 1 ? '' : 's'} missing`,
      detail:
        candidate.missingCount === 0
          ? 'The candidate included every PB currently stored for this player.'
          : 'Missing stored records may indicate an incomplete profile, different game profile, or partial collection.',
    },
  ];

  if (candidate.newCount > 0) {
    signals.push({
      tone: 'neutral',
      label: `${candidate.newCount} new PB${candidate.newCount === 1 ? '' : 's'}`,
      detail: 'These records do not exist on the canonical profile and would be added after promotion.',
    });
  }
  if (lastAcceptedSyncAt) {
    signals.push({
      tone: 'neutral',
      label: 'Previous install last synced successfully',
      detail: `The incumbent credential completed an accepted sync at ${lastAcceptedSyncAt.toISOString()}.`,
    });
  }
  if (candidate.status === 'pending') {
    signals.push({
      tone: 'positive',
      label: 'No credential contest detected',
      detail:
        'The incumbent credential has not synced again and no second candidate credential has appeared since this candidate was captured.',
    });
  } else if (candidate.status === 'contested') {
    signals.push({
      tone: 'danger',
      label: 'Credential activity is contested',
      detail:
        'The incumbent credential returned or another candidate appeared. Promotion is disabled until this conflict is investigated.',
    });
  }

  let recommendation: {
    action: string;
    tone: RecoverySignalTone;
    title: string;
    detail: string;
  };
  if (candidate.status === 'contested') {
    recommendation = {
      action: 'do_not_promote',
      tone: 'danger',
      title: 'Do not promote',
      detail: 'Investigate the competing credential activity. Reject the candidate if it is not expected.',
    };
  } else if (candidate.status === 'promoted') {
    recommendation = {
      action: 'complete',
      tone: 'positive',
      title: 'Recovery completed',
      detail: 'This credential has already been promoted and its eligible faster/new PBs were applied.',
    };
  } else if (candidate.status === 'rejected') {
    recommendation = {
      action: 'complete',
      tone: 'neutral',
      title: 'Candidate rejected',
      detail: 'No credential or canonical PB changes were made.',
    };
  } else if (candidate.attemptCount < 2) {
    recommendation = {
      action: 'verify_or_wait',
      tone: 'caution',
      title: 'Verify the reinstall or wait for another observation',
      detail:
        continuity === 'strong'
          ? 'PB continuity is strong, but this credential has only appeared once. Promote only if the reinstall is expected from support context; otherwise wait for another natural sync.'
          : 'One request with limited continuity is not enough evidence. Investigate before making a credential decision.',
    };
  } else if (continuity === 'strong') {
    recommendation = {
      action: 'verify_then_promote',
      tone: 'positive',
      title: 'Promotion is reasonable after contextual verification',
      detail:
        'The same candidate has returned and PB continuity is strong. Confirm the player is expected to have reinstalled or moved devices before promoting.',
    };
  } else {
    recommendation = {
      action: 'investigate',
      tone: 'caution',
      title: 'Investigate before promoting',
      detail: 'The candidate has repeated, but its PB continuity is incomplete or conflicting.',
    };
  }

  return {
    why: {
      code: 'INSTALL_CREDENTIAL_MISMATCH',
      title: 'A known player synced from a different install credential',
      detail:
        'The backend recognized the same player account identifier but rejected the install credential. The submitted PBs are quarantined and public data remains unchanged.',
    },
    continuity: {
      level: continuity,
      coveragePercent,
      overlapCount,
      storedCount,
      title: `${continuity[0].toUpperCase()}${continuity.slice(1)} PB continuity`,
      detail: 'PB continuity is supporting evidence only; it cannot cryptographically prove account ownership.',
    },
    recommendation,
    promotionEffect: {
      title: `Promotion would apply ${wouldChangeCount} PB change${wouldChangeCount === 1 ? '' : 's'}`,
      detail: `${candidate.improvedCount} faster and ${candidate.newCount} new PBs would be applied. ${candidate.equalCount} equal and ${candidate.slowerCount} slower PBs would not overwrite canonical data. The candidate credential would replace the incumbent credential.`,
      wouldChangeCount,
    },
    lastAcceptedSyncAt: lastAcceptedSyncAt?.toISOString() ?? null,
    signals,
    limitation:
      'Account hashes and PB similarity identify continuity, not ownership. The recommendation still requires operator judgment.',
  };
}
