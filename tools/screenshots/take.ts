/**
 * Takes the README screenshots in `assets/screenshots/` from the real browser, the same way the
 * release workflow takes them for the website: a test package, the built website and
 * `app/tests/screenshots/capture.ts` under Xvfb. Linux only; needs `xvfb-run` and ImageMagick.
 * Run it in every release pull request, so the README shows the released version.
 *
 * Usage: `pnpm screenshots`
 */
import { spawnSync, type SpawnSyncOptions } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const app = join(root, 'app');
const { slug } = JSON.parse(readFileSync(join(root, 'brand.json'), 'utf8')) as { slug: string };

/**
 * Runs a command with inherited output and fails on a non-zero exit code.
 * @param command - Program.
 * @param args - Arguments.
 * @param options - Working directory and extra environment.
 */
function run(
  command: string,
  args: readonly string[],
  options: { cwd: string; env?: Record<string, string> },
): void {
  const spawnOptions: SpawnSyncOptions = {
    cwd: options.cwd,
    stdio: 'inherit',
    env: { ...process.env, ...options.env },
  };
  const result = spawnSync(command, args, spawnOptions);
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with ${String(result.status)}`);
  }
}

const packages = mkdtempSync(join(tmpdir(), 'screenshots-'));
try {
  const testBuild = { E2E_BUILD: '1', PACKAGE_DIR: packages };
  run('pnpm', ['exec', 'electron-vite', 'build'], { cwd: app, env: testBuild });
  run(
    'pnpm',
    [
      'exec',
      'electron-builder',
      '--config',
      'electron-builder.config.mjs',
      '--publish',
      'never',
      '--dir',
    ],
    { cwd: app, env: testBuild },
  );
  run('pnpm', ['--dir', 'website', 'run', 'build'], {
    cwd: root,
    env: { ASTRO_TELEMETRY_DISABLED: '1' },
  });
  run(
    'xvfb-run',
    [
      '-a',
      '-s',
      '-screen 0 3000x2000x24 -nocursor',
      process.execPath,
      'tests/screenshots/capture.ts',
      '../website/dist',
      '../assets/screenshots',
    ],
    { cwd: app, env: { E2E_APP: join(packages, 'linux-unpacked', slug) } },
  );
} finally {
  rmSync(packages, { recursive: true, force: true });
}
