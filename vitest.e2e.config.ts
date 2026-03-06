import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/e2e/**/*.test.ts'],
    testTimeout: 30000, // 30 seconds for E2E tests
    hookTimeout: 30000,
    // Run tests sequentially to avoid port conflicts (Vitest 4 format)
    pool: 'forks',
    poolMatchGlobs: [
      ['**/*.test.ts', 'forks'],
    ],
    maxConcurrency: 1,
    fileParallelism: false,
    // Fail fast on first error in CI
    bail: process.env.CI ? 1 : undefined,
  },
});
