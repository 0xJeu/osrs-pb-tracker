import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['./test/setup.ts'],
    // DO NOT PARALLELIZE: every test file shares the same Neon test branch
    // and relies on truncateAll() (see test/helpers.ts) for isolation.
    // Running files in parallel would let them truncate each other's data
    // mid-test.
    fileParallelism: false,
  },
});
