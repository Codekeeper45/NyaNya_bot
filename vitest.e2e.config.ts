import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/e2e/**/*.test.ts'],
    setupFiles: ['src/test/env.ts'],
    testTimeout: 15000,
  },
  resolve: {
    extensionAlias: { '.js': ['.ts', '.js'] },
  },
});
