import { performance } from 'node:perf_hooks';
import { brotliCompressSync, brotliDecompressSync, gzipSync } from 'node:zlib';
import { config } from 'dotenv';
import { neon } from '@neondatabase/serverless';

const envPath = process.argv[2];
if (!envPath) {
  throw new Error('Usage: node scripts/measure-public-snapshot.mjs /absolute/path/to/.env');
}

config({ path: envPath, override: true, quiet: true });
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is missing from the selected environment file');

const sql = neon(connectionString);
const iso = (value) => new Date(value).toISOString();
const byNewestPlayer = (a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id - b.id;
const percentile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;
const timed = async (fn) => {
  const started = performance.now();
  const value = await fn();
  return { value, milliseconds: performance.now() - started };
};

const source = await timed(async () => {
  const [playerRows, historyRows, pbRows] = await Promise.all([
    sql`SELECT id, display_name, display_name_lower, updated_at FROM players ORDER BY id`,
    sql`SELECT player_id, display_name_lower FROM player_name_history ORDER BY player_id, display_name_lower`,
    sql`SELECT player_id, boss, time_seconds, updated_at FROM personal_bests ORDER BY player_id, boss`,
  ]);
  return { playerRows, historyRows, pbRows };
});

const reference = await timed(() => sql`
  SELECT
    player_id,
    boss,
    time_seconds,
    updated_at,
    RANK() OVER (PARTITION BY boss ORDER BY time_seconds ASC)::integer AS rank
  FROM personal_bests
  ORDER BY player_id, boss
`);

const buildStarted = performance.now();
const players = source.value.playerRows.map((row) => ({
  id: Number(row.id),
  displayName: row.display_name,
  displayNameLower: row.display_name_lower,
  updatedAt: iso(row.updated_at),
}));
const playerById = new Map(players.map((player) => [player.id, player]));
const pbsByBoss = new Map();
for (const row of source.value.pbRows) {
  const pb = {
    playerId: Number(row.player_id),
    boss: row.boss,
    timeSeconds: Number(row.time_seconds),
    updatedAt: iso(row.updated_at),
  };
  const rows = pbsByBoss.get(pb.boss) ?? [];
  rows.push(pb);
  pbsByBoss.set(pb.boss, rows);
}

const rankedByPlayer = new Map(players.map((player) => [player.id, []]));
for (const rows of pbsByBoss.values()) {
  rows.sort((a, b) => a.timeSeconds - b.timeSeconds || a.playerId - b.playerId);
  let priorTime;
  let rank = 0;
  rows.forEach((pb, index) => {
    if (priorTime === undefined || pb.timeSeconds !== priorTime) {
      rank = index + 1;
      priorTime = pb.timeSeconds;
    }
    rankedByPlayer.get(pb.playerId)?.push({
      boss: pb.boss,
      timeSeconds: pb.timeSeconds,
      updatedAt: pb.updatedAt,
      rank,
    });
  });
}
for (const rows of rankedByPlayer.values()) rows.sort((a, b) => a.boss.localeCompare(b.boss));

const currentIdsByName = new Map();
for (const player of [...players].sort(byNewestPlayer)) {
  const ids = currentIdsByName.get(player.displayNameLower) ?? [];
  ids.push(player.id);
  currentIdsByName.set(player.displayNameLower, ids);
}
const historicIdsByName = new Map();
for (const row of source.value.historyRows) {
  const id = Number(row.player_id);
  const ids = historicIdsByName.get(row.display_name_lower) ?? [];
  if (!ids.includes(id)) ids.push(id);
  historicIdsByName.set(row.display_name_lower, ids);
}
for (const ids of historicIdsByName.values()) {
  ids.sort((a, b) => byNewestPlayer(playerById.get(a), playerById.get(b)));
}

const allNames = [...new Set([...currentIdsByName.keys(), ...historicIdsByName.keys()])].sort();
const playerIdsByLookupName = Object.fromEntries(
  allNames.map((name) => {
    const ids = [...(currentIdsByName.get(name) ?? []), ...(historicIdsByName.get(name) ?? [])];
    return [name, [...new Set(ids)]];
  })
);

const profilesByPlayerId = Object.fromEntries(
  players.map((player) => [
    String(player.id),
    {
      id: player.id,
      displayName: player.displayName,
      updatedAt: player.updatedAt,
      pbs: rankedByPlayer.get(player.id) ?? [],
    },
  ])
);

const snapshot = {
  schemaVersion: 1,
  revision: 'measurement-only',
  generatedAt: new Date().toISOString(),
  sourceCounts: {
    players: players.length,
    nameHistory: source.value.historyRows.length,
    personalBests: source.value.pbRows.length,
    bosses: pbsByBoss.size,
  },
  bosses: [...pbsByBoss.keys()].sort(),
  playerIdsByLookupName,
  profilesByPlayerId,
};
const buildMilliseconds = performance.now() - buildStarted;

const referenceRows = reference.value.map((row) => ({
  playerId: Number(row.player_id),
  boss: row.boss,
  timeSeconds: Number(row.time_seconds),
  updatedAt: iso(row.updated_at),
  rank: Number(row.rank),
}));
const snapshotRows = Object.values(profilesByPlayerId).flatMap((profile) =>
  profile.pbs.map((pb) => ({ playerId: profile.id, ...pb }))
);
const equivalence = {
  rankedRowsEqual: JSON.stringify(snapshotRows) === JSON.stringify(referenceRows),
  rowCountEqual: snapshotRows.length === referenceRows.length,
  missingPlayerReferences: source.value.pbRows.filter((row) => !playerById.has(Number(row.player_id))).length,
  unresolvedHistoryReferences: source.value.historyRows.filter((row) => !playerById.has(Number(row.player_id))).length,
};

const raw = Buffer.from(JSON.stringify(snapshot));
const gzip = gzipSync(raw, { level: 9 });
const brotli = brotliCompressSync(raw);
const brotliBase64 = Buffer.from(brotli.toString('base64'));
const redisCommandBody = Buffer.from(JSON.stringify(['SET', 'pbt:prod:v1:public:snapshot', brotli.toString('base64')]));

const profileSizes = Object.values(profilesByPlayerId)
  .map((profile) => Buffer.byteLength(JSON.stringify(profile)))
  .sort((a, b) => a - b);
const indexBytes = Buffer.byteLength(JSON.stringify(playerIdsByLookupName));
const bossBytes = Buffer.byteLength(JSON.stringify(snapshot.bosses));

const decodeSamples = [];
for (let i = 0; i < 200; i += 1) {
  const start = performance.now();
  JSON.parse(brotliDecompressSync(Buffer.from(brotliBase64.toString(), 'base64')).toString('utf8'));
  decodeSamples.push(performance.now() - start);
}
decodeSamples.sort((a, b) => a - b);

const monthlyScenarios = [
  { name: 'observed relevant CDN misses', reads: 1770, writes: 355 },
  { name: 'all captured requests reach Redis', reads: 10730, writes: 355 },
  { name: '10x relevant traffic', reads: 17700, writes: 3550 },
  { name: '10x all captured traffic', reads: 107300, writes: 3550 },
].map((scenario) => ({
  ...scenario,
  commands: scenario.reads + scenario.writes,
  transferBytes: (scenario.reads + scenario.writes) * redisCommandBody.length,
}));

const report = {
  measuredAt: new Date().toISOString(),
  data: snapshot.sourceCounts,
  timingsMs: {
    sourceQueriesConcurrent: Number(source.milliseconds.toFixed(2)),
    independentRankQuery: Number(reference.milliseconds.toFixed(2)),
    snapshotBuild: Number(buildMilliseconds.toFixed(2)),
    decodeP50: Number(percentile(decodeSamples, 0.5).toFixed(3)),
    decodeP95: Number(percentile(decodeSamples, 0.95).toFixed(3)),
  },
  bytes: {
    rawJson: raw.length,
    gzip: gzip.length,
    brotli: brotli.length,
    brotliBase64: brotliBase64.length,
    estimatedRedisSetRequest: redisCommandBody.length,
    lookupNameIndex: indexBytes,
    bossList: bossBytes,
    profileP50: percentile(profileSizes, 0.5),
    profileP95: percentile(profileSizes, 0.95),
    profileMax: profileSizes.at(-1) ?? 0,
  },
  compressionRatio: {
    gzip: Number((gzip.length / raw.length).toFixed(4)),
    brotli: Number((brotli.length / raw.length).toFixed(4)),
    encodedRedisPayload: Number((redisCommandBody.length / raw.length).toFixed(4)),
  },
  equivalence,
  lookupBehavior: {
    names: allNames.length,
    ambiguousNames: Object.values(playerIdsByLookupName).filter((ids) => ids.length > 1).length,
    maxMatchesForName: Math.max(0, ...Object.values(playerIdsByLookupName).map((ids) => ids.length)),
  },
  monthlyScenarios: monthlyScenarios.map((scenario) => ({
    ...scenario,
    transferGiB: Number((scenario.transferBytes / 1024 ** 3).toFixed(3)),
    commandAllowancePercent: Number(((scenario.commands / 500000) * 100).toFixed(2)),
    bandwidthAllowancePercent: Number(((scenario.transferBytes / 10_000_000_000) * 100).toFixed(2)),
  })),
};

console.log(JSON.stringify(report, null, 2));
if (!Object.values(equivalence).every((value) => value === true || value === 0)) process.exitCode = 2;
