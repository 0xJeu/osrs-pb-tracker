import { config } from 'dotenv';

config({ path: '.env.staging' });

const { assertDatabaseTarget } = await import('../src/db/targetGuard.js');
await assertDatabaseTarget('seeded-staging');

const { app } = await import('../src/app.js');

async function getJson(path: string) {
  const response = await app.request(path);
  if (!response.ok) {
    throw new Error(`Staging API smoke failed: GET ${path} returned ${response.status}`);
  }
  return response.json();
}

const profile = await getJson('/api/players/Nightmare%20QA');
const leaderboard = await getJson(
  `/api/leaderboard/${encodeURIComponent("phosani's nightmare")}?limit=10`
);
const search = await getJson('/api/search/all?q=nightmare');
const recent = await getJson('/api/recent-syncs?limit=10');
const stats = await getJson('/api/stats');

const pnm = profile?.pbs?.find((pb: { boss?: string }) => pb.boss === "phosani's nightmare");
const leaderboardRows = Array.isArray(leaderboard) ? leaderboard : leaderboard?.rows;
const trackedPlayers = Number(stats?.trackedPlayers);
const personalBestRecords = Number(stats?.personalBestRecords);

if (
  profile?.displayName !== 'Nightmare QA' ||
  pnm?.timeSeconds !== 283.8 ||
  !leaderboardRows?.some((row: { displayName?: string }) => row.displayName === 'Nightmare QA') ||
  !search?.some(
    (row: { type?: string; value?: string }) =>
      row.type === 'player' && row.value === 'Nightmare QA'
  ) ||
  !recent?.some((row: { displayName?: string }) => row.displayName === 'Nightmare QA') ||
  !Number.isFinite(trackedPlayers) ||
  trackedPlayers < 8 ||
  !Number.isFinite(personalBestRecords) ||
  personalBestRecords < 25
) {
  throw new Error('Staging API smoke failed: fixture data did not match route responses');
}

console.log(
  `Staging API smoke passed: profile PNM ${pnm.timeSeconds}s, ` +
    `${leaderboardRows.length} leaderboard row(s), ${trackedPlayers} players, ` +
    `${personalBestRecords} PBs.`
);
