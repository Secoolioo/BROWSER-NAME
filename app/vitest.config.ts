import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

const brand: unknown = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../brand.json'), 'utf8'),
);

export default defineConfig({
  define: { BUILD_BRAND: JSON.stringify(brand) },
  test: {
    include: ['src/**/__tests__/**/*.test.ts'],
    environment: 'node',
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/__tests__/**',
        // Electron-bound code: covered by the end-to-end tests against the packaged app.
        'src/main/**',
        'src/preload/**',
        'src/ui/shell/**',
        'src/platform/electron/app-protocol.ts',
        'src/platform/electron/browser-window.ts',
        'src/platform/electron/ipc-router.ts',
        'src/platform/electron/session-security.ts',
      ],
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
