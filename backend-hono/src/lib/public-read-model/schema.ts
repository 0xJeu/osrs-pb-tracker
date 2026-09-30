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

export function isPublicSnapshotV1(value: unknown): value is PublicSnapshotV1 {
  if (!value || typeof value !== 'object') return false;
  const snapshot = value as Partial<PublicSnapshotV1>;
  if (!(snapshot.schemaVersion === PUBLIC_SNAPSHOT_SCHEMA_VERSION
    && typeof snapshot.revision === 'string'
    && typeof snapshot.generatedAt === 'string'
    && Boolean(snapshot.sourceCounts && typeof snapshot.sourceCounts === 'object')
    && Array.isArray(snapshot.bosses)
    && Boolean(snapshot.playerIdsByLookupName && typeof snapshot.playerIdsByLookupName === 'object')
    && Boolean(snapshot.profilesByPlayerId && typeof snapshot.profilesByPlayerId === 'object'))) {
    return false;
  }
  const counts = snapshot.sourceCounts as PublicSnapshotV1['sourceCounts'];
  if (![counts.players, counts.nameHistory, counts.personalBests, counts.bosses]
    .every((count) => Number.isSafeInteger(count) && count >= 0)) return false;
  if (!snapshot.bosses!.every((boss) => typeof boss === 'string')) return false;
  for (const ids of Object.values(snapshot.playerIdsByLookupName!)) {
    if (!Array.isArray(ids) || !ids.every((id) => Number.isSafeInteger(id) && id > 0)) return false;
  }
  const profiles = Object.values(snapshot.profilesByPlayerId!);
  if (profiles.length !== counts.players) return false;
  let pbCount = 0;
  for (const profile of profiles) {
    if (!profile || typeof profile !== 'object'
      || !Number.isSafeInteger(profile.id) || profile.id <= 0
      || typeof profile.displayName !== 'string'
      || typeof profile.updatedAt !== 'string'
      || !Array.isArray(profile.pbs)) return false;
    for (const pb of profile.pbs) {
      if (!pb || typeof pb !== 'object'
        || typeof pb.boss !== 'string'
        || !Number.isFinite(pb.timeSeconds)
        || typeof pb.updatedAt !== 'string'
        || !Number.isSafeInteger(pb.rank) || pb.rank <= 0) return false;
      pbCount += 1;
    }
  }
  return pbCount === counts.personalBests && snapshot.bosses!.length === counts.bosses;
}

export function normalizePublicSnapshotDates(snapshot: PublicSnapshotV1): PublicSnapshotV1 {
  snapshot.generatedAt = new Date(snapshot.generatedAt).toISOString();
  for (const profile of Object.values(snapshot.profilesByPlayerId)) {
    profile.updatedAt = new Date(profile.updatedAt).toISOString();
    for (const pb of profile.pbs) pb.updatedAt = new Date(pb.updatedAt).toISOString();
  }
  return snapshot;
}
