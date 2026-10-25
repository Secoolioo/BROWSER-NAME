/**
 * Runs every local check in sequence and stops at the first failure.
 * CI runs exactly the same command, so a green `pnpm verify` locally
 * means the `verify` job will pass as well.
 *
 * Usage: `pnpm verify` or `pnpm verify --only format,markdown`
 */
import { spawnSync } from 'node:child_process';

/** A single check that `pnpm verify` can run. */
interface Check {
  /** Identifier used with `--only`. */
  readonly name: string;
  /** Description printed before the check runs. */
  readonly title: string;
  /** Executable followed by its arguments. */
  readonly command: readonly [string, ...string[]];
  /**
   * When true, the check is skipped locally if the executable is missing.
   * CI always runs it.
   */
  readonly optionalLocally?: boolean;
  /** Extra environment variables for the command. */
  readonly env?: Readonly<Record<string, string>>;
}

const checks: readonly Check[] = [
  {
    name: 'format',
    title: 'Formatting (Prettier)',
    command: ['pnpm', 'exec', 'prettier', '--check', '.'],
  },
  {
    name: 'markdown',
    title: 'Markdown lint',
    command: ['pnpm', 'exec', 'markdownlint-cli2'],
  },
  {
    name: 'typecheck',
    title: 'Type check (tsc --build)',
    command: ['pnpm', 'exec', 'tsc', '--build', 'app', 'tools'],
  },
  {
    name: 'lint',
    title: 'Lint (Oxlint, type-aware)',
    command: ['pnpm', 'exec', 'oxlint', '--type-aware', '--deny-warnings'],
  },
  {
    name: 'architecture',
    title: 'Architecture rules (dependency-cruiser)',
    command: [
      'node',
      'tools/node_modules/dependency-cruiser/bin/dependency-cruiser.mjs',
      '--config',
      '.dependency-cruiser.cjs',
      'app/src',
    ],
  },
  {
    name: 'test',
    title: 'Unit and integration tests with coverage (Vitest)',
    command: ['pnpm', '--dir', 'app', 'exec', 'vitest', 'run', '--coverage'],
  },
  {
    name: 'api',
    title: 'API documentation comments (TypeDoc)',
    command: ['pnpm', '--dir', 'website', 'run', 'check:api'],
  },
  {
    name: 'website',
    title: 'Website build (Astro)',
    command: ['pnpm', '--dir', 'website', 'run', 'build'],
    env: { ASTRO_TELEMETRY_DISABLED: '1' },
  },
  {
    name: 'shell',
    title: 'Shell scripts (ShellCheck)',
    command: [
      'shellcheck',
      'tools/owner/setup.sh',
      'tools/release/import-mac-certificate.sh',
      'app/tests/linux-repos/run.sh',
      'app/tests/linux-repos/live.sh',
    ],
    optionalLocally: true,
  },
];

/**
 * Parses `--only a,b` into a set of check names.
 * @param argv - Process arguments without the node and script paths.
 * @returns The selected names, or `undefined` when all checks should run.
 */
function parseOnly(argv: readonly string[]): ReadonlySet<string> | undefined {
  const index = argv.indexOf('--only');
  if (index === -1) {
    return undefined;
  }
  const value = argv[index + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new Error('--only expects a comma-separated list of check names');
  }
  return new Set(value.split(',').map((name) => name.trim()));
}

/**
 * Tells whether an executable can be found on the PATH.
 * @param executable - Name of the program.
 */
function isAvailable(executable: string): boolean {
  const probe = process.platform === 'win32' ? 'where' : 'which';
  return spawnSync(probe, [executable], { stdio: 'ignore' }).status === 0;
}

/**
 * Runs the selected checks.
 * @returns The process exit code.
 */
function main(): number {
  const only = parseOnly(process.argv.slice(2));
  const selected = checks.filter((check) => only === undefined || only.has(check.name));
  if (selected.length === 0) {
    console.error(`No checks match. Available: ${checks.map((c) => c.name).join(', ')}`);
    return 2;
  }
  let skipped = 0;
  for (const check of selected) {
    console.log(`\n▶ ${check.title}`);
    const [executable, ...args] = check.command;
    if (
      check.optionalLocally === true &&
      process.env['CI'] === undefined &&
      !isAvailable(executable)
    ) {
      console.log(`  skipped: ${executable} is not installed (CI runs this check)`);
      skipped += 1;
      continue;
    }
    const result = spawnSync(executable, args, {
      stdio: 'inherit',
      shell: process.platform === 'win32',
      env: { ...process.env, ...check.env },
    });
    if (result.status !== 0) {
      console.error(`\n✖ ${check.title} failed`);
      return result.status ?? 1;
    }
  }
  const passed = selected.length - skipped;
  console.log(`\n✔ ${passed} check(s) passed${skipped > 0 ? `, ${skipped} skipped` : ''}`);
  return 0;
}

process.exitCode = main();
