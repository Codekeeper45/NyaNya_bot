import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    coverage: { provider: 'v8', reporter: ['text', 'lcov'] },
    exclude: ['**/node_modules/**', '**/dist/**', '**/.worktrees/**'],
  },
  resolve: {
    extensionAlias: { '.js': ['.ts', '.js'] },
  },
});
