import { spawnSync } from 'node:child_process';
import { config } from 'dotenv';
import type { DatabaseRole } from '../src/db/targetGuard.js';

const role = process.argv[2] as DatabaseRole | undefined;
if (role !== 'destructive-test' && role !== 'seeded-staging') {
  throw new Error('Usage: migrate-guarded.ts <destructive-test|seeded-staging>');
}

config({ path: role === 'destructive-test' ? '.env.test' : '.env.staging' });

const { assertDatabaseTarget } = await import('../src/db/targetGuard.js');
await assertDatabaseTarget(role);

const result = spawnSync('npm', ['run', 'db:migrate'], {
  env: process.env,
  stdio: 'inherit',
});

if (result.error) throw result.error;
process.exit(result.status ?? 1);
