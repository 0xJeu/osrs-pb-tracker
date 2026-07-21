import { config } from 'dotenv';
import type { DatabaseRole } from '../src/db/targetGuard.js';

const role = process.argv[2] as DatabaseRole | undefined;
const command = process.argv[3];

if (role !== 'destructive-test' && role !== 'seeded-staging') {
  throw new Error(
    'Usage: recovery-admin.ts <destructive-test|seeded-staging> <list|promote|reject> [candidate-id] [actor] [reason]'
  );
}

config({
  path: role === 'destructive-test' ? '.env.test' : '.env.staging',
  override: true,
});

const { assertDatabaseTarget } = await import('../src/db/targetGuard.js');
await assertDatabaseTarget(role);

if (command === 'list') {
  const { listSafeInstallRecoveryCandidates } = await import('../src/lib/installRecovery.js');
  const candidates = await listSafeInstallRecoveryCandidates();

  console.table(candidates);
  process.exit(0);
}

if (command !== 'promote' && command !== 'reject') {
  throw new Error(
    'Command must be list, promote, or reject. Decisions require: <candidate-id> <actor> [reason]'
  );
}

const candidateId = Number.parseInt(process.argv[4] ?? '', 10);
const actor = process.argv[5]?.trim();
const reason = process.argv.slice(6).join(' ').trim() || undefined;
if (!Number.isSafeInteger(candidateId) || candidateId <= 0 || !actor) {
  throw new Error(`${command} requires a positive candidate ID and a non-empty actor`);
}

const { promoteInstallRecoveryCandidate, rejectInstallRecoveryCandidate } = await import(
  '../src/lib/installRecovery.js'
);
if (command === 'promote') {
  const result = await promoteInstallRecoveryCandidate(candidateId, actor, reason);
  console.log(
    JSON.stringify(
      {
        command,
        candidateId: result.candidateId,
        playerId: result.playerId,
        changedPbCount: result.changedBosses.length,
      },
      null,
      2
    )
  );
} else {
  const result = await rejectInstallRecoveryCandidate(candidateId, actor, reason);
  console.log(JSON.stringify({ command, ...result }, null, 2));
}
