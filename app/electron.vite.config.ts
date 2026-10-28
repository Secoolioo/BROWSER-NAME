import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';

const brand: unknown = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../brand.json'), 'utf8'),
);
const define = { BUILD_BRAND: JSON.stringify(brand) };

export default defineConfig({
  main: {
    define,
    build: {
      outDir: 'out/main',
      lib: { entry: 'src/main/index.ts', formats: ['es'] },
    },
  },
  preload: {
    define,
    build: {
      outDir: 'out/preload',
      rollupOptions: {
        input: { shell: 'src/preload/shell.ts', page: 'src/preload/page.ts' },
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: {
    define,
    root: 'src/ui',
    base: '/',
    build: {
      outDir: 'out/renderer',
      emptyOutDir: true,
      modulePreload: { polyfill: false },
      rollupOptions: {
        input: {
          shell: resolve(import.meta.dirname, 'src/ui/shell/index.html'),
          'sandbox-help': resolve(import.meta.dirname, 'src/ui/sandbox-help/index.html'),
        },
      },
    },
  },
});
