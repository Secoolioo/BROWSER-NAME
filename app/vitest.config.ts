import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/__tests__/**/*.test.ts'],
    environment: 'node',
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/__tests__/**'],
      reporter: ['text-summary', 'json-summary'],
      thresholds: {
        lines: 80,
        branches: 80,
        functions: 80,
        statements: 80,
        'src/kernel/**': { lines: 90, branches: 90, functions: 90, statements: 90 },
        'src/domain/**': { lines: 90, branches: 90, functions: 90, statements: 90 },
      },
    },
  },
});
