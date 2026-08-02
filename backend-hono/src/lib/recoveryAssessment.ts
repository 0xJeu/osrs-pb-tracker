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
  activeInstallCount?: number;
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
  const lane = candidate.status === 'contested'
    ? 'contested'
    : candidate.status === 'promoted' || candidate.status === 'rejected'
      ? 'completed'
      : candidate.status === 'pending' && candidate.attemptCount >= 2 && continuity === 'strong'
        ? 'easy'
        : 'investigate';

  const signals: RecoverySignal[] = [
    {
      tone: 'caution',
      label: 'Different install credential',
      detail:
        `The account identifier already has ${candidate.activeInstallCount ?? 1} authorized installation(s), so this unknown credential was quarantined instead of changing public data.`,
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
      detail: 'These records do not exist on the canonical profile and may be added by the next normal sync after authorization.',
    });
  }
  if (lastAcceptedSyncAt) {
    signals.push({
      tone: 'neutral',
      label: 'Last database-recorded accepted change',
      detail: `A meaningful accepted sync for this player was recorded at ${lastAcceptedSyncAt.toISOString()}. No-op and replayed requests are intentionally omitted, so this is not installation liveness.`,
    });
  }
  if (candidate.status === 'invalidation_pending') {
    signals.push({
      tone: 'caution',
      label: 'Legacy replay gate remains',
      detail: 'This candidate predates additive install authorization. Reopen it to move it into current pending review.',
    });
  } else if (candidate.status === 'pending') {
    signals.push({
      tone: 'positive',
      label: 'No credential contest detected',
      detail:
        'No competing unknown credential has appeared since this candidate was captured. Activity from already-authorized installations is expected and does not create a contest.',
    });
  } else if (candidate.status === 'invalidation_failed') {
    signals.push({
      tone: 'caution',
      label: 'Legacy replay gate failed',
      detail: 'This takeover-era gate is not required for additive authorization. Reopen the candidate for current review.',
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
  if (candidate.status === 'invalidation_pending') {
    recommendation = {
      action: 'reopen',
      tone: 'caution',
      title: 'Reopen legacy candidate',
      detail: 'Move this preexisting row into current pending review. Reopening does not authorize the installation.',
    };
  } else if (candidate.status === 'invalidation_failed') {
    recommendation = {
      action: 'reopen',
      tone: 'caution',
      title: 'Reopen legacy candidate',
      detail: 'Additive authorization no longer depends on incumbent replay invalidation. Reopen this row, then review it normally.',
    };
  } else if (candidate.status === 'contested') {
    recommendation = {
      action: 'do_not_promote',
      tone: 'danger',
      title: 'Do not promote',
      detail: 'Review the support context. If this exact candidate is verified, resolve the contest first; that rejects competing unknown candidates but does not authorize an installation. Review again before a separate authorization.',
    };
  } else if (candidate.status === 'promoted') {
    recommendation = {
      action: 'complete',
      tone: 'positive',
      title: 'Recovery completed',
      detail: 'This credential is authorized. Its next plugin retry will run through the normal faster-only PB sync path.',
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
      title: 'Approval would authorize one additional installation',
      detail: `Approval does not apply this quarantined submission. On the plugin's next automatic retry, normal sync rules can apply up to ${wouldChangeCount} faster/new PB change${wouldChangeCount === 1 ? '' : 's'} while preserving equal or slower canonical data. Existing authorized installations remain active.`,
      wouldChangeCount,
    },
    lane,
    activeInstallCount: candidate.activeInstallCount ?? 1,
    lastAcceptedSyncAt: lastAcceptedSyncAt?.toISOString() ?? null,
    signals,
    limitation:
      'Account hashes and PB similarity identify continuity, not ownership. The recommendation still requires operator judgment.',
  };
}
