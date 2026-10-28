/**
 * End-to-end update test on Windows (NSIS) and Linux (AppImage). It installs build 1 and
 * points it at a local signed feed through the real `UpdateURL` policy, so the shipped code
 * needs no test switch. Build 1 must first refuse a tampered feed, then download build 2
 * from a valid one and install it when it quits. Afterwards, build 2 must start.
 *
 * Usage: node app/tests/updater/run.ts --old <packages 1> --new <packages 2>
 *   --old-version <v1> --new-version <v2> --key <private.pem>
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import {
  appendFileSync,
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../../..');
const brand = JSON.parse(readFileSync(join(root, 'brand.json'), 'utf8')) as {
  productName: string;
  slug: string;
};
const args = process.argv.slice(2);
const option = (name: string): string => {
  const value = args[args.indexOf(`--${name}`) + 1];
  if (!args.includes(`--${name}`) || value === undefined) throw new Error(`Missing --${name}`);
  return value;
};
const oldPackages = resolve(option('old'));
const newPackages = resolve(option('new'));
const oldVersion = option('old-version');
const newVersion = option('new-version');
const key = resolve(option('key'));
const port = 8123;
const feedUrl = `http://127.0.0.1:${port}/`;
const windows = process.platform === 'win32';

const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

function run(command: string, commandArgs: readonly string[], input?: string): string {
  console.log(`$ ${command} ${commandArgs.join(' ')}`);
  const result = spawnSync(command, commandArgs, {
    encoding: 'utf8',
    ...(input === undefined ? {} : { input }),
  });
  if (result.status !== 0) {
    throw new Error(`${command} failed with ${String(result.status)}: ${result.stderr}`);
  }
  return result.stdout;
}

async function waitFor(
  what: string,
  seconds: number,
  test: () => boolean,
  running?: ChildProcess,
): Promise<void> {
  const deadline = Date.now() + seconds * 1000;
  while (!test()) {
    if (running !== undefined && running.exitCode !== null) {
      throw new Error(`The browser exited with ${running.exitCode} while waiting for ${what}`);
    }
    if (Date.now() > deadline) throw new Error(`Timed out after ${seconds} s: ${what}`);
    await sleep(500);
  }
}

/** Publishes both builds and a signed feed for the new one in a site folder. */
function buildSite(site: string, tamper: boolean): void {
  rmSync(site, { recursive: true, force: true });
  for (const [dir, version] of [
    [oldPackages, oldVersion],
    [newPackages, newVersion],
  ] as const) {
    const target = join(site, 'download', `v${version}`);
    mkdirSync(target, { recursive: true });
    for (const name of readdirSync(dir)) {
      if (/\.(exe|AppImage|blockmap|yml)$/.test(name))
        copyFileSync(join(dir, name), join(target, name));
    }
  }
  run(process.execPath, [
    join(root, 'tools/feed/feed.ts'),
    'build',
    '--packages',
    newPackages,
    '--version',
    newVersion,
    '--channel',
    'beta',
    '--key',
    key,
    '--out',
    site,
    '--download-base',
    `download/v${newVersion}/`,
  ]);
  if (tamper) appendFileSync(join(site, 'updates/v1/index.json'), ' ');
}

function setPolicy(): void {
  if (windows) {
    run('reg', [
      'add',
      `HKLM\\SOFTWARE\\Policies\\${brand.productName}`,
      '/v',
      'UpdateURL',
      '/t',
      'REG_SZ',
      '/d',
      feedUrl,
      '/f',
    ]);
  } else {
    const dir = `/etc/${brand.slug}/policies/managed`;
    run('sudo', ['mkdir', '-p', dir]);
    run('sudo', ['tee', `${dir}/updates.json`], JSON.stringify({ UpdateURL: feedUrl }));
  }
}

/** Installs build 1 and returns the program to start. */
async function install(): Promise<string> {
  const file = readdirSync(oldPackages).find((n) =>
    (windows ? /-setup\.exe$/ : /\.AppImage$/).test(n),
  );
  if (file === undefined) throw new Error('No package of build 1');
  if (windows) {
    run(join(oldPackages, file), ['/S']);
    const exe = join(
      process.env['LOCALAPPDATA'] ?? '',
      'Programs',
      brand.slug,
      `${brand.slug}.exe`,
    );
    await waitFor('the installed program', 60, () => existsSync(exe));
    return exe;
  }
  const target = join(homedir(), 'Applications', `${brand.slug}.AppImage`);
  mkdirSync(join(homedir(), 'Applications'), { recursive: true });
  copyFileSync(join(oldPackages, file), target);
  chmodSync(target, 0o755);
  return target;
}

interface Running {
  readonly child: ChildProcess;
  readonly profile: string;
}

function start(program: string, profile: string, keepRunning: boolean, report: string): Running {
  const childArgs = [`--user-data-dir=${profile}`, `--smoke-test=${report}`];
  if (keepRunning) childArgs.push('--smoke-test-keep-running');
  console.log(`$ ${program} ${childArgs.join(' ')}`);
  const child = spawn(program, childArgs, { stdio: 'inherit' });
  return { child, profile };
}

function logLines(profile: string): { message: string; fields?: Record<string, unknown> }[] {
  const file = join(profile, 'logs', 'main.log');
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as { message: string; fields?: Record<string, unknown> });
}

/** The browser's main process: the started program itself, or the child of the AppImage runtime. */
function browserPid(child: ChildProcess): number {
  if (child.pid === undefined) throw new Error('No process id');
  if (windows) return child.pid;
  const ps = run('ps', ['-eo', 'pid=,ppid=,args=']);
  const rows = ps
    .split('\n')
    .map((line) => /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line))
    .filter((match) => match !== null)
    .map((match) => ({ pid: Number(match[1]), ppid: Number(match[2]), args: match[3] ?? '' }));
  const descendants = new Set([child.pid]);
  for (let added = true; added;) {
    added = false;
    for (const row of rows) {
      if (descendants.has(row.ppid) && !descendants.has(row.pid)) {
        descendants.add(row.pid);
        added = true;
      }
    }
  }
  // The AppImage runtime carries the same arguments; the browser is a descendant of it.
  const browser = rows.find(
    (row) =>
      row.pid !== child.pid &&
      descendants.has(row.pid) &&
      row.args.includes('--smoke-test=') &&
      !row.args.includes('--type='),
  );
  return browser?.pid ?? child.pid;
}

/** Asks the browser to quit the way a user or the system would. */
async function quit(running: Running): Promise<void> {
  const exited = new Promise<void>((done) => {
    if (running.child.exitCode !== null) done();
    else running.child.once('exit', () => done());
  });
  const pid = browserPid(running.child);
  if (windows) spawnSync('taskkill', ['/pid', String(pid)], { stdio: 'inherit' });
  else process.kill(pid, 'SIGTERM');
  await Promise.race([
    exited,
    sleep(60_000).then(() => {
      throw new Error('The browser did not quit within 60 s');
    }),
  ]);
}

function installerRunning(): boolean {
  const list = spawnSync('tasklist', ['/fo', 'csv', '/nh'], { encoding: 'utf8' }).stdout;
  return list.toLowerCase().includes('-setup.exe');
}

async function main(): Promise<void> {
  const work = mkdtempSync(join(tmpdir(), 'updater-'));
  const site = join(work, 'site');
  buildSite(site, true);
  const server = spawn(
    process.execPath,
    [join(root, 'tools/feed/feed.ts'), 'serve', site, String(port)],
    {
      stdio: 'inherit',
    },
  );
  try {
    setPolicy();
    const program = await install();

    console.log('Build 1 must refuse a tampered feed.');
    const first = start(program, join(work, 'profile-1'), true, join(work, 'report-1.json'));
    await waitFor(
      'the refused feed',
      150,
      () =>
        logLines(first.profile).some(
          (l) => l.message === 'Update failed' && l.fields?.['code'] === 'signature',
        ),
      first.child,
    );
    await quit(first);

    console.log('Build 1 must download build 2 from a valid feed and install it on quit.');
    buildSite(site, false);
    const second = start(program, join(work, 'profile-2'), true, join(work, 'report-2.json'));
    await waitFor(
      'the downloaded update',
      300,
      () => logLines(second.profile).some((l) => l.message.startsWith('Update ready')),
      second.child,
    );
    await quit(second);
    if (windows) {
      await sleep(5000);
      await waitFor('the installer to finish', 180, () => !installerRunning());
    }

    console.log('Build 2 must start.');
    const report = join(work, 'report-3.json');
    const third = start(program, join(work, 'profile-3'), false, report);
    await new Promise<void>((done) => third.child.once('exit', () => done()));
    const result = JSON.parse(readFileSync(report, 'utf8')) as { ok: boolean; version: string };
    console.log(JSON.stringify(result));
    if (!result.ok || result.version !== newVersion) {
      throw new Error(`Expected a working ${newVersion}, found ${result.version}`);
    }
    console.log(`Update test passed: ${oldVersion} → ${newVersion}`);
  } finally {
    server.kill();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
