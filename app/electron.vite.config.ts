import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { defineConfig } from 'electron-vite';

const brand: unknown = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../brand.json'), 'utf8'),
);
// Public keys that verify the update feed: the current key and its successor. Test builds
// point UPDATE_KEYS_DIR at test keys; without keys, the build cannot update itself.
const keysDir = resolve(import.meta.dirname, process.env['UPDATE_KEYS_DIR'] ?? 'build/keys');
const updateKeys = existsSync(keysDir)
  ? readdirSync(keysDir)
      .filter((name) => /^update-.+\.pub\.pem$/.test(name))
      .toSorted()
      .map((name) => readFileSync(join(keysDir, name), 'utf8'))
  : [];
const define = { BUILD_BRAND: JSON.stringify(brand) };

export default defineConfig({
  main: {
    define: { ...define, BUILD_UPDATE_KEYS: JSON.stringify(updateKeys) },
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
