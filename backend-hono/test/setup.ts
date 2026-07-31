import { config } from 'dotenv';
import { afterAll, beforeEach } from 'vitest';
import { assertDatabaseTarget } from '../src/db/targetGuard.js';

config({ path: '.env.test' });

await assertDatabaseTarget('destructive-test');

/**
 * Every test file gets the same clean slate, centrally.
 *
 * These resets used to live in each file's own beforeEach, and the coverage had
 * drifted: only sync.test.ts reset all three, several files reset just the
 * database, and a few reset nothing at all. Because the rate limiter and the
 * replay cache are module-level singletons shared by every file in a worker,
 * whichever file ran next inherited whatever state the previous one left -
 * making failures depend on execution order and timing rather than on the code
 * under test.
 *
 * Registering the hooks here (setupFiles run before any file's own hooks) means
 * a new test file cannot forget them.
 *
 * Everything that reaches the database is imported *dynamically* below rather
 * than at the top of this file: src/db/ throws on import when DATABASE_URL is
 * unset, and ESM hoists every static import above the config() call that loads
 * .env.test. Deferring these until the hook actually runs is what keeps that
 * import graph loadable.
 */
beforeEach(async () => {
  // Best-effort by design: the production code treats replay-cache
  // invalidation as an optimization rather than a correctness dependency, and a
  // test file may mock @vercel/functions with only the surface it needs. Neither
  // a mocked cache nor an unavailable one should fail an unrelated test.
  try {
    const { resetSyncReplayCache } = await import('../src/lib/syncReplay.js');
    await resetSyncReplayCache();
  } catch {
    // Intentionally ignored - see above.
  }

  // These two are correctness-critical, so failures here must surface.
  const { truncateAll } = await import('./helpers.js');
  const { resetRateLimiter } = await import('../src/lib/secret.js');
  await truncateAll();
  resetRateLimiter();
});

// beforeEach alone leaves the final test's rows behind for whatever file runs
// next, which is how one file's fixtures end up being asserted against in
// another.
afterAll(async () => {
  const { truncateAll } = await import('./helpers.js');
  await truncateAll();
});
