/**
 * Performance harness: measures a packaged build against a bare Electron reference in the
 * same job and checks the budgets of docs/architecture/performance.md. The browser and
 * the reference alternate, so both see the same runner state.
 *
 * Usage: `node tools/perf/run.ts --app <packaged executable> [--out perf.json]`
 * Options: `--runs <n>` start-up runs (20), `--memory-runs <n>` (10), `--cpu-seconds <s>`
 * (60) and `--settle-seconds <s>` (15).
 */
import type { ChildProcess } from 'node:child_process';
import {
  appendFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { cpus, tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { FuseV1Options, FuseVersion, flipFuses } from '@electron/fuses';
import { mannWhitneyGreater, median } from './stats.ts';
import { memoryMetric, sampleTree, startTree, stopTree, type TreeSample } from './system.ts';

const root = resolve(import.meta.dirname, '../..');
const mib = 1024 * 1024;
const kib = 1024;

/** A program the harness starts: the browser or the bare reference. */
interface Variant {
  readonly name: 'browser' | 'bare';
  readonly executable: string;
}

/** The result of one budget check. */
interface Check {
  readonly metric: string;
  readonly value: string;
  readonly budget: string;
  readonly pass: boolean;
}

/** Collected measurements of both variants. */
interface Measurements {
  startupMs: Record<Variant['name'], number[]>;
  memoryBytes: Record<Variant['name'], number[]>;
  cpuPercent: Record<Variant['name'], number[]>;
  /** Start-up marks per run. */
  marks: Record<Variant['name'], Record<string, number>[]>;
}

const options = parseOptions(process.argv.slice(2));
const profilesDir = mkdtempSync(join(tmpdir(), 'perf-profiles-'));

/** The budgets, as documented in docs/architecture/performance.md. */
const budgets = {
  startupExtraMs: 120,
  startupFactor: 1.25,
  startupCeilingMs: process.platform === 'darwin' ? 800 : 1000,
  memoryExtraBytes: (process.platform === 'darwin' ? 50 : 60) * mib,
  memoryCeilingBytes: 350 * mib,
  cpuIdlePercent: 0.5,
  cpuExtraPoints: 0.2,
  // A timing budget fails only when this test is significant; see stats.ts.
  significance: 0.01,
  startChunkBytes: 300 * kib,
  uiTotalBytes: 1024 * kib,
  preloadBytes: 20 * kib,
  mainStartBytes: 150 * kib,
  unpackedExtraBytes: 25 * mib,
} as const;

function parseOptions(args: readonly string[]): {
  app: string;
  out: string;
  runs: number;
  memoryRuns: number;
  cpuSeconds: number;
  settleSeconds: number;
} {
  const value = (name: string, fallback?: string): string => {
    const index = args.indexOf(`--${name}`);
    const found = index === -1 ? fallback : args[index + 1];
    if (found === undefined) throw new Error(`Missing --${name}`);
    return found;
  };
  return {
    app: resolve(value('app')),
    out: resolve(value('out', 'perf.json')),
    runs: Number(value('runs', '20')),
    memoryRuns: Number(value('memory-runs', '10')),
    cpuSeconds: Number(value('cpu-seconds', '60')),
    settleSeconds: Number(value('settle-seconds', '15')),
  };
}

const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

function percentile(values: readonly number[], p: number): number {
  const sorted = values.toSorted((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? 0;
}

const kb = (bytes: number): string => `${(bytes / kib).toFixed(1)} KB`;

/** Size of a file or directory tree, without following symbolic links. */
function sizeOf(path: string): number {
  const stat = lstatSync(path);
  if (!stat.isDirectory()) return stat.size;
  return readdirSync(path).reduce((sum, name) => sum + sizeOf(join(path, name)), 0);
}

/** The `.app` bundle of a macOS executable, or the folder of any other executable. */
function installRoot(executable: string): string {
  return process.platform === 'darwin' ? resolve(executable, '../../..') : dirname(executable);
}

/**
 * Copies the Electron distribution and installs the bare reference as its app, with the
 * fuses of a shipped package. Only the two asar fuses stay off, because the reference is
 * a plain folder.
 */
async function prepareBare(work: string): Promise<{ executable: string; distribution: string }> {
  const appRequire = createRequire(join(root, 'app/package.json'));
  const electronExecutable = appRequire('electron') as unknown as string;
  const distribution = installRoot(electronExecutable);
  const copy = join(work, basename(distribution));
  cpSync(distribution, copy, { recursive: true, verbatimSymlinks: true });
  const executable = join(copy, electronExecutable.slice(distribution.length));
  const resources =
    process.platform === 'darwin' ? join(copy, 'Contents/Resources') : join(copy, 'resources');
  cpSync(join(root, 'app/tests/perf/bare'), join(resources, 'app'), { recursive: true });
  await flipFuses(process.platform === 'darwin' ? copy : executable, {
    version: FuseVersion.V1,
    resetAdHocDarwinSignature: process.platform === 'darwin',
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableCookieEncryption]: true,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
  });
  return { executable, distribution };
}

/**
 * Starts a variant with a fresh profile, waits for its report, runs `measure` while it is
 * open and stops it again.
 * @returns Milliseconds from the spawn to the loaded UI, and the measured value.
 */
async function launch<T>(
  variant: Variant,
  measure: (child: ChildProcess) => Promise<T>,
): Promise<{ readyMs: number; value: T; marks: Record<string, number> }> {
  const work = mkdtempSync(join(tmpdir(), `perf-${variant.name}-`));
  const report = join(work, 'report.json');
  const args = [
    // Each variant keeps its profile across runs, so later starts are warm starts.
    `--user-data-dir=${join(profilesDir, variant.name)}`,
    `--smoke-test=${report}`,
    '--smoke-test-keep-running',
  ];
  if (process.platform === 'linux' && process.getuid?.() === 0) args.push('--no-sandbox');
  const spawnedAt = Date.now();
  const child = startTree(variant.executable, args);
  try {
    const deadline = spawnedAt + 60_000;
    while (!existsSync(report)) {
      if (child.exitCode !== null || child.signalCode !== null) {
        throw new Error(`${variant.name} exited before it was ready`);
      }
      if (Date.now() > deadline) throw new Error(`${variant.name} was not ready within 60 s`);
      await sleep(10);
    }
    const ready = JSON.parse(readFileSync(report, 'utf8')) as {
      ok: boolean;
      readyAt: number;
      marks?: Record<string, number>;
    };
    if (!ready.ok) throw new Error(`${variant.name} reported a failed start`);
    const value = await measure(child);
    return { readyMs: ready.readyAt - spawnedAt, value, marks: ready.marks ?? {} };
  } finally {
    await stopTree(child);
    rmSync(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
}

function sample(child: ChildProcess): TreeSample {
  if (child.pid === undefined) throw new Error('The process has no id');
  return sampleTree(child.pid);
}

async function measureStartup(variants: readonly Variant[], m: Measurements): Promise<void> {
  const warmup = 2;
  for (let i = 0; i < warmup + options.runs; i += 1) {
    // Alternate the order, so neither variant always runs on a cache the other warmed.
    for (const variant of i % 2 === 0 ? variants : variants.toReversed()) {
      const { readyMs, marks } = await launch(variant, () => Promise.resolve());
      if (i >= warmup) {
        m.startupMs[variant.name].push(readyMs);
        m.marks[variant.name].push(marks);
      }
    }
  }
}

async function measureMemory(variants: readonly Variant[], m: Measurements): Promise<void> {
  for (let i = 0; i < options.memoryRuns; i += 1) {
    for (const variant of i % 2 === 0 ? variants : variants.toReversed()) {
      const { value } = await launch(variant, async (child) => {
        await sleep(options.settleSeconds * 1000);
        return sample(child).memoryBytes;
      });
      m.memoryBytes[variant.name].push(value);
    }
  }
}

async function measureCpu(variants: readonly Variant[], m: Measurements): Promise<void> {
  for (const variant of variants) {
    const { value } = await launch(variant, async (child) => {
      await sleep(options.settleSeconds * 1000);
      const before = sample(child);
      const startedAt = performance.now();
      await sleep(options.cpuSeconds * 1000);
      const after = sample(child);
      return ((after.cpuMs - before.cpuMs) / (performance.now() - startedAt)) * 100;
    });
    m.cpuPercent[variant.name].push(value);
  }
}

function startupChecks(m: Measurements): Check[] {
  const browser = median(m.startupMs.browser);
  const bare = median(m.startupMs.bare);
  // On the 3-core macOS runners the bare reference alone took between 337 and 935 ms, so an
  // absolute ceiling would judge the runner, not the browser. There it is only reported.
  const ceilingGates = process.platform !== 'darwin';
  const limit = Math.min(
    bare + budgets.startupExtraMs,
    bare * budgets.startupFactor,
    ceilingGates ? budgets.startupCeilingMs : Infinity,
  );
  // The browser exceeds the budget only if its times are significantly larger than the
  // bare times shifted by the allowed difference, not just because its median is.
  const allowed = m.startupMs.bare.map((t) => t + (limit - bare));
  const p = mannWhitneyGreater(m.startupMs.browser, allowed);
  return [
    {
      metric: 'Warm start, spawn to interactive UI (median)',
      value: `${browser.toFixed(0)} ms (bare ${bare.toFixed(0)} ms, p = ${p.toFixed(3)})`,
      budget: ceilingGates
        ? `≤ ${limit.toFixed(0)} ms`
        : `≤ ${limit.toFixed(0)} ms (ceiling ${budgets.startupCeilingMs} ms reported only)`,
      pass: browser <= limit || p >= budgets.significance,
    },
  ];
}

function memoryChecks(m: Measurements): Check[] {
  const browser = median(m.memoryBytes.browser);
  const bare = median(m.memoryBytes.bare);
  const ceiling = process.platform === 'linux' ? budgets.memoryCeilingBytes : Infinity;
  const limit = Math.min(bare + budgets.memoryExtraBytes, ceiling);
  return [
    {
      metric: `Memory, idle after ${options.settleSeconds} s (${memoryMetric}, median)`,
      value: `${(browser / mib).toFixed(1)} MB (bare ${(bare / mib).toFixed(1)} MB)`,
      budget: `≤ ${(limit / mib).toFixed(1)} MB`,
      pass: browser <= limit,
    },
  ];
}

function cpuChecks(m: Measurements): Check[] {
  const browser = median(m.cpuPercent.browser);
  const bare = median(m.cpuPercent.bare);
  const limit = Math.min(budgets.cpuIdlePercent, bare + budgets.cpuExtraPoints);
  return [
    {
      metric: `CPU, idle for ${options.cpuSeconds} s (all processes)`,
      value: `${browser.toFixed(2)} % (bare ${bare.toFixed(2)} %)`,
      budget: `≤ ${limit.toFixed(2)} % of one core`,
      pass: browser <= limit,
    },
  ];
}

/**
 * JavaScript files that an HTML page loads at once: its scripts and module preloads.
 * @param htmlFile - The page.
 * @param rendererRoot - Directory that absolute references start from.
 */
function startFiles(htmlFile: string, rendererRoot: string): string[] {
  const html = readFileSync(htmlFile, 'utf8');
  const refs = html.matchAll(/<(?:script|link)\b[^>]*?\b(?:src|href)="([^"]+\.js)"/g);
  return [...refs].map(({ 1: ref = '' }) =>
    ref.startsWith('/') ? join(rendererRoot, ref) : resolve(dirname(htmlFile), ref),
  );
}

/** The main entry and the chunks it imports statically, recursively. */
function staticImports(file: string, seen = new Set<string>()): Set<string> {
  if (seen.has(file)) return seen;
  seen.add(file);
  const code = readFileSync(file, 'utf8');
  for (const match of code.matchAll(
    /^\s*import\s+(?:[^'"]*?\sfrom\s*)?["'](\.{1,2}\/[^"']+)["']/gm,
  )) {
    staticImports(resolve(dirname(file), match[1] ?? ''), seen);
  }
  return seen;
}

function bundleChecks(): Check[] {
  const out = join(root, 'app/out');
  const renderer = join(out, 'renderer');
  const shellFiles = startFiles(join(renderer, 'shell/index.html'), renderer);
  if (shellFiles.length === 0) throw new Error('The shell page loads no JavaScript');
  const startChunk = shellFiles.reduce((sum, file) => sum + sizeOf(file), 0);
  const uiTotal = readdirSync(join(renderer, 'assets'))
    .filter((name) => name.endsWith('.js'))
    .reduce((sum, name) => sum + sizeOf(join(renderer, 'assets', name)), 0);
  const preloads = readdirSync(join(out, 'preload')).map((name) => ({
    name,
    size: sizeOf(join(out, 'preload', name)),
  }));
  const mainStart = [...staticImports(join(out, 'main/index.js'))].reduce(
    (sum, file) => sum + sizeOf(file),
    0,
  );
  return [
    {
      metric: 'UI start chunk (shell)',
      value: kb(startChunk),
      budget: `≤ ${kb(budgets.startChunkBytes)}`,
      pass: startChunk <= budgets.startChunkBytes,
    },
    {
      metric: 'All UI JavaScript',
      value: kb(uiTotal),
      budget: `≤ ${kb(budgets.uiTotalBytes)}`,
      pass: uiTotal <= budgets.uiTotalBytes,
    },
    ...preloads.map((preload) => ({
      metric: `Preload ${preload.name}`,
      value: kb(preload.size),
      budget: `≤ ${kb(budgets.preloadBytes)}`,
      pass: preload.size <= budgets.preloadBytes,
    })),
    {
      metric: 'Main process start-up path',
      value: kb(mainStart),
      budget: `≤ ${kb(budgets.mainStartBytes)}`,
      pass: mainStart <= budgets.mainStartBytes,
    },
  ];
}

function sizeChecks(distribution: string): Check[] {
  const browser = sizeOf(installRoot(options.app));
  const bare = sizeOf(distribution);
  const limit = bare + budgets.unpackedExtraBytes;
  return [
    {
      metric: 'Unpacked size',
      value: `${(browser / mib).toFixed(1)} MB (bare ${(bare / mib).toFixed(1)} MB)`,
      budget: `≤ ${(limit / mib).toFixed(1)} MB`,
      pass: browser <= limit,
    },
  ];
}

/**
 * Measures a group and checks its budgets; a failing group is measured once more before
 * it fails, as the method allows.
 */
async function measured(
  name: string,
  variants: readonly Variant[],
  m: Measurements,
  measure: (variants: readonly Variant[], m: Measurements) => Promise<void>,
  reset: (m: Measurements) => void,
  check: (m: Measurements) => Check[],
): Promise<Check[]> {
  console.log(`Measuring ${name} …`);
  await measure(variants, m);
  let checks = check(m);
  if (checks.some((c) => !c.pass)) {
    console.log(`${name}: over budget, measuring once more`);
    reset(m);
    await measure(variants, m);
    checks = check(m);
  }
  return checks;
}

function medianMarks(runs: readonly Record<string, number>[]): Record<string, number> {
  const names = [...new Set(runs.flatMap((marks) => Object.keys(marks)))];
  return Object.fromEntries(names.map((name) => [name, median(runs.map((r) => r[name] ?? 0))]));
}

function markLine(runs: readonly Record<string, number>[]): string {
  return Object.entries(medianMarks(runs))
    .map(([name, value]) => `${name} ${value.toFixed(0)} ms`)
    .join(' · ');
}

function table(checks: readonly Check[]): string {
  const rows = checks.map(
    (c) => `| ${c.metric} | ${c.value} | ${c.budget} | ${c.pass ? 'pass' : '**fail**'} |`,
  );
  return ['| Metric | Value | Budget | Result |', '| --- | --- | --- | --- |', ...rows].join('\n');
}

async function main(): Promise<void> {
  const work = mkdtempSync(join(tmpdir(), 'perf-'));
  try {
    const bare = await prepareBare(work);
    const variants: readonly Variant[] = [
      { name: 'browser', executable: options.app },
      { name: 'bare', executable: bare.executable },
    ];
    const m: Measurements = {
      startupMs: { browser: [], bare: [] },
      memoryBytes: { browser: [], bare: [] },
      cpuPercent: { browser: [], bare: [] },
      marks: { browser: [], bare: [] },
    };
    const checks = [
      ...bundleChecks(),
      ...sizeChecks(bare.distribution),
      ...(await measured(
        'start-up',
        variants,
        m,
        measureStartup,
        (r) => {
          r.startupMs = { browser: [], bare: [] };
          r.marks = { browser: [], bare: [] };
        },
        startupChecks,
      )),
      ...(await measured(
        'memory',
        variants,
        m,
        measureMemory,
        (r) => {
          r.memoryBytes = { browser: [], bare: [] };
        },
        memoryChecks,
      )),
      ...(await measured(
        'CPU',
        variants,
        m,
        measureCpu,
        (r) => {
          r.cpuPercent = { browser: [], bare: [] };
        },
        cpuChecks,
      )),
    ];
    const result = {
      platform: process.platform,
      arch: process.arch,
      cpus: cpus().length,
      memoryMetric,
      options,
      marks: { browser: medianMarks(m.marks.browser), bare: medianMarks(m.marks.bare) },
      startupMs: {
        browser: { median: median(m.startupMs.browser), p90: percentile(m.startupMs.browser, 90) },
        bare: { median: median(m.startupMs.bare), p90: percentile(m.startupMs.bare, 90) },
      },
      samples: m,
      checks,
    };
    writeFileSync(options.out, `${JSON.stringify(result, null, 2)}\n`);
    const summary =
      `## Performance (${process.platform} ${process.arch})\n\n${table(checks)}\n\n` +
      `Start-up marks since process start (median): browser ${markLine(m.marks.browser)}; ` +
      `bare ${markLine(m.marks.bare)}\n`;
    console.log(summary);
    const stepSummary = process.env['GITHUB_STEP_SUMMARY'];
    if (stepSummary !== undefined) appendFileSync(stepSummary, summary);
    if (checks.some((c) => !c.pass)) {
      console.error('Performance budgets exceeded.');
      process.exitCode = 1;
    }
  } finally {
    rmSync(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    rmSync(profilesDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
