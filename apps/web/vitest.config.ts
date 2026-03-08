import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    env: {
      JWT_SECRET: 'test-jwt-secret-for-vitest-minimum-32-chars!!',
      MONGODB_URI: 'mongodb://localhost:27017/test',
      REDIS_URL: 'redis://localhost:6379',
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/**',
        'dist/**',
        '**/*.d.ts',
        '**/*.config.*',
        '**/tests/**',
      ],
    },
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
