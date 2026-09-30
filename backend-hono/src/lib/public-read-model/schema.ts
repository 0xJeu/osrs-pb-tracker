export const PUBLIC_SNAPSHOT_SCHEMA_VERSION = 1 as const;

export interface PublicSnapshotPb {
  boss: string;
  timeSeconds: number;
  updatedAt: string;
  rank: number;
}

export interface PublicSnapshotProfile {
  id: number;
  displayName: string;
  updatedAt: string;
  pbs: PublicSnapshotPb[];
}

export interface PublicSnapshotV1 {
  schemaVersion: typeof PUBLIC_SNAPSHOT_SCHEMA_VERSION;
  revision: string;
  generatedAt: string;
  sourceCounts: {
    players: number;
    nameHistory: number;
    personalBests: number;
    bosses: number;
  };
  bosses: string[];
  playerIdsByLookupName: Record<string, number[]>;
  profilesByPlayerId: Record<string, PublicSnapshotProfile>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

export function isPublicSnapshotV1(value: unknown): value is PublicSnapshotV1 {
  if (!isRecord(value)) return false;
  const snapshot = value as Partial<PublicSnapshotV1>;
  if (!(snapshot.schemaVersion === PUBLIC_SNAPSHOT_SCHEMA_VERSION
    && typeof snapshot.revision === 'string' && /^(0|[1-9]\d*)$/.test(snapshot.revision)
    && typeof snapshot.generatedAt === 'string'
    && isRecord(snapshot.sourceCounts)
    && Array.isArray(snapshot.bosses)
    && isRecord(snapshot.playerIdsByLookupName)
    && isRecord(snapshot.profilesByPlayerId))) {
    return false;
  }
  const counts = snapshot.sourceCounts as PublicSnapshotV1['sourceCounts'];
  if (![counts.players, counts.nameHistory, counts.personalBests, counts.bosses]
    .every((count) => Number.isSafeInteger(count) && count >= 0)) return false;
  if (!snapshot.bosses!.every((boss) => typeof boss === 'string')) return false;
  const bossSet = new Set(snapshot.bosses);
  if (bossSet.size !== counts.bosses) return false;
  const profileEntries = Object.entries(snapshot.profilesByPlayerId!);
  if (profileEntries.length !== counts.players) return false;
  let pbCount = 0;
  for (const [key, profile] of profileEntries) {
    if (!isRecord(profile)
      || !Number.isSafeInteger(profile.id) || profile.id <= 0
      || key !== String(profile.id)
      || typeof profile.displayName !== 'string'
      || typeof profile.updatedAt !== 'string'
      || !Array.isArray(profile.pbs)) return false;
    for (const pb of profile.pbs) {
      if (!isRecord(pb)
        || typeof pb.boss !== 'string'
        || !bossSet.has(pb.boss)
        || !Number.isFinite(pb.timeSeconds)
        || typeof pb.updatedAt !== 'string'
        || !Number.isSafeInteger(pb.rank) || pb.rank <= 0) return false;
      pbCount += 1;
    }
  }
  for (const ids of Object.values(snapshot.playerIdsByLookupName!)) {
    if (!Array.isArray(ids) || !ids.every((id) => Number.isSafeInteger(id)
      && id > 0 && String(id) in snapshot.profilesByPlayerId!)) return false;
  }
  return pbCount === counts.personalBests;
}

export function normalizePublicSnapshotDates(snapshot: PublicSnapshotV1): PublicSnapshotV1 {
  snapshot.generatedAt = new Date(snapshot.generatedAt).toISOString();
  for (const profile of Object.values(snapshot.profilesByPlayerId)) {
    profile.updatedAt = new Date(profile.updatedAt).toISOString();
    for (const pb of profile.pbs) pb.updatedAt = new Date(pb.updatedAt).toISOString();
  }
  return snapshot;
}
