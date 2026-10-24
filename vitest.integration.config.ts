import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['packages/db/tests/*.integration.test.ts'],
    fileParallelism: false,
    testTimeout: 15000,
    hookTimeout: 15000,
    passWithNoTests: false,
  },
});
