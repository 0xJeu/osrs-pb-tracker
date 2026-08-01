import { config } from 'dotenv';
import type { DatabaseRole } from '../src/db/targetGuard.js';

const role = process.argv[2] as DatabaseRole | undefined;
if (role !== 'destructive-test' && role !== 'seeded-staging') {
  throw new Error('Usage: run-guarded-dev.ts <destructive-test|seeded-staging>');
}

config({
  path: role === 'destructive-test' ? '.env.test' : '.env.staging',
  override: true,
});

const { assertDatabaseTarget } = await import('../src/db/targetGuard.js');
await assertDatabaseTarget(role);
await import('../src/index.node.js');
