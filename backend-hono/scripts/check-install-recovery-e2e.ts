import { config } from 'dotenv';

config({ path: '.env.staging', override: true });

if (!process.argv.includes('--confirm')) {
  throw new Error(
    'Install recovery E2E is write-enabled. Re-run with --confirm after verifying .env.staging.'
  );
}

const { assertDatabaseTarget } = await import('../src/db/targetGuard.js');
await assertDatabaseTarget('seeded-staging');

const { cleanupInstallRecoveryE2eFixture, runInstallRecoveryE2e } = await import(
  './lib/install-recovery-e2e.js'
);

if (process.argv.includes('--cleanup')) {
  await cleanupInstallRecoveryE2eFixture();
  console.log('Removed the exact synthetic 0xSteph install-recovery E2E fixture.');
} else {
  const report = await runInstallRecoveryE2e();
  console.log(JSON.stringify(report, null, 2));
}
