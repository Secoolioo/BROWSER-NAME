/**
 * Installs a package silently, starts the browser in self-test mode, checks the report and
 * the Electron fuses, and uninstalls the package again.
 *
 * Usage: `node tools/package/smoke.ts <format> <package-file-or-directory>`
 * Formats: `nsis`, `msi`, `dmg`, `appimage`, `appimage-no-sandbox`, `deb`, `dir`.
 */
import { spawn, spawnSync, type ChildProcess, type SpawnSyncReturns } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';

/** Product identifiers, read from brand.json. */
interface Brand {
  readonly productName: string;
  readonly slug: string;
}

/** Fields of the self-test report that are checked. */
interface Report {
  readonly ok: boolean;
  readonly mode?: string;
  readonly version: string;
  readonly packaged: boolean;
  readonly rendererSandboxed: boolean | 'unknown';
  readonly shellReadyMs: number;
  readonly errors: readonly string[];
}

const root = resolve(import.meta.dirname, '../..');
const brand = JSON.parse(readFileSync(join(root, 'brand.json'), 'utf8')) as Brand;
const expectedVersion = (
  JSON.parse(readFileSync(join(root, 'app/package.json'), 'utf8')) as { version: string }
).version;

/** Fuse values every shipped package must have. */
const expectedFuses: Readonly<Record<string, 'Enabled' | 'Disabled'>> = {
  RunAsNode: 'Disabled',
  EnableCookieEncryption: 'Enabled',
  EnableNodeOptionsEnvironmentVariable: 'Disabled',
  EnableNodeCliInspectArguments: 'Disabled',
  EnableEmbeddedAsarIntegrityValidation: 'Enabled',
  OnlyLoadAppFromAsar: 'Enabled',
  GrantFileProtocolExtraPrivileges: 'Disabled',
};

/**
 * Runs a command and fails on a non-zero exit code. An installer that hangs fails after
 * five minutes instead of blocking the job until its own timeout.
 * @param command - Program.
 * @param args - Arguments.
 */
function run(command: string, args: readonly string[]): SpawnSyncReturns<string> {
  console.log(`${new Date().toISOString()} $ ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 5 * 60_000,
    killSignal: 'SIGKILL',
  });
  if (result.error !== undefined) {
    throw new Error(`${command} did not finish: ${result.error.message}`, { cause: result.error });
  }
  if (result.status !== 0) {
    throw new Error(
      `${command} failed with ${String(result.status)}: ${result.stderr}${result.stdout}`,
    );
  }
  return result;
}

/**
 * Finds the first file below a directory whose name matches. Symbolic links are not
 * followed, such as the `Applications` link in a disk image.
 * @param dir - Directory to search.
 * @param match - Name test.
 */
function find(dir: string, match: (name: string, path: string) => boolean): string | undefined {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (match(name, path)) {
      return path;
    }
    if (lstatSync(path).isDirectory() && !name.endsWith('.app')) {
      const found = find(path, match);
      if (found !== undefined) {
        return found;
      }
    }
  }
  return undefined;
}

/**
 * Stops the browser and every process it started. Helper processes can outlive the browser,
 * and a browser that hangs must not block the uninstaller or the CI step.
 * @param child - The browser process.
 * @param executable - Its program file.
 */
function stopBrowser(child: ChildProcess, executable: string): void {
  if (process.platform === 'win32') {
    // Helpers whose browser has exited no longer belong to its process tree, so they are
    // matched by program name.
    const kill = spawnSync('taskkill', ['/F', '/T', '/IM', basename(executable)], {
      encoding: 'utf8',
      timeout: 60_000,
    });
    console.log(`${new Date().toISOString()} taskkill: ${kill.stdout}${kill.stderr}`);
    return;
  }
  if (child.pid === undefined) return;
  try {
    // The browser leads its own process group; this stops the group.
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    // The group has already ended.
  }
}

/**
 * Starts the browser in self-test mode and returns its report. Its output is forwarded
 * through pipes instead of being inherited: a helper process that outlives the browser
 * would otherwise keep the output of the CI step open, and the step would never end.
 * @param executable - Program to start.
 * @param args - Extra arguments.
 */
async function selfTest(executable: string, args: readonly string[] = []): Promise<Report> {
  const dir = mkdtempSync(join(tmpdir(), 'smoke-'));
  const reportPath = join(dir, 'report.json');
  console.log(`$ ${executable} ${[...args, `--smoke-test=${reportPath}`].join(' ')}`);
  const child = spawn(executable, [...args, `--smoke-test=${reportPath}`], {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  });
  child.stdout.on('data', (chunk: Buffer) => process.stdout.write(chunk));
  child.stderr.on('data', (chunk: Buffer) => process.stderr.write(chunk));
  const code = await new Promise<number | null>((done) => {
    const timer = setTimeout(() => done(null), 120_000);
    child.on('exit', (exitCode) => {
      clearTimeout(timer);
      done(exitCode);
    });
  });
  console.log(`${new Date().toISOString()} browser exit code ${String(code)}`);
  stopBrowser(child, executable);
  child.stdout.destroy();
  child.stderr.destroy();
  if (code === null) {
    throw new Error('The browser did not finish its self-test within 120 seconds');
  }
  if (!existsSync(reportPath)) {
    throw new Error(`The browser exited with ${String(code)} without writing a report`);
  }
  const report = JSON.parse(readFileSync(reportPath, 'utf8')) as Report;
  rmSync(dir, { recursive: true, force: true });
  console.log(JSON.stringify(report, null, 2));
  return report;
}

/**
 * Checks a self-test report of a normal start.
 * @param report - The report.
 * @param sandbox - Whether renderers must be sandboxed.
 */
function checkReport(report: Report, sandbox: boolean): void {
  const problems = [...report.errors];
  if (!report.ok) problems.push('report.ok is false');
  if (report.mode !== undefined) problems.push(`unexpected mode ${report.mode}`);
  if (!report.packaged) problems.push('the app does not run as a packaged app');
  if (report.version !== expectedVersion)
    problems.push(`version ${report.version}, expected ${expectedVersion}`);
  if (sandbox && report.rendererSandboxed !== true)
    problems.push(`renderer sandbox: ${String(report.rendererSandboxed)}`);
  if (problems.length > 0) {
    throw new Error(`Self-test failed:\n- ${problems.join('\n- ')}`);
  }
}

/**
 * Reads the fuses of an app and compares them with the expected values.
 * @param app - Executable, or the `.app` bundle on macOS.
 */
function checkFuses(app: string): void {
  const cli = join(root, 'tools/node_modules/@electron/fuses/dist/bin.js');
  const output = run(process.execPath, [cli, 'read', '--app', app]).stdout;
  const wrong = Object.entries(expectedFuses).filter(
    ([fuse, state]) => !new RegExp(`\\b${fuse} is ${state}\\b`).test(output),
  );
  if (wrong.length > 0) {
    throw new Error(`Unexpected fuses:\n${output}`);
  }
  console.log('Fuses as expected.');
}

/**
 * Writes the AppArmor profile that the sandbox fix installs, when the system restricts
 * user namespaces.
 */
function installAppImageProfile(): void {
  const restricted = existsSync('/proc/sys/kernel/apparmor_restrict_unprivileged_userns')
    ? readFileSync('/proc/sys/kernel/apparmor_restrict_unprivileged_userns', 'utf8').trim() === '1'
    : false;
  if (!restricted) {
    console.log('User namespaces are not restricted; no profile needed.');
    return;
  }
  const file = `/etc/apparmor.d/${brand.slug}-appimage`;
  const profile = [
    'abi <abi/4.0>,',
    'include <tunables/global>',
    `profile ${brand.slug}-appimage /tmp/.mount_*/${brand.slug} flags=(unconfined) {`,
    '  userns,',
    '}',
    '',
  ].join('\n');
  const tee = spawnSync('sudo', ['tee', file], { input: profile, encoding: 'utf8' });
  if (tee.status !== 0) throw new Error('Could not write the AppArmor profile');
  run('sudo', ['apparmor_parser', '-r', file]);
}

async function main(): Promise<void> {
  const [format, input] = process.argv.slice(2);
  if (format === undefined || input === undefined) {
    throw new Error('Usage: node tools/package/smoke.ts <format> <package>');
  }
  const pkg = resolve(input);
  switch (format) {
    case 'nsis': {
      run(pkg, ['/S']);
      const dir = join(process.env['LOCALAPPDATA'] ?? '', 'Programs', brand.slug);
      const exe = join(dir, `${brand.slug}.exe`);
      checkFuses(exe);
      checkReport(await selfTest(exe), true);
      const uninstaller = find(dir, (name) => /^Uninstall .*\.exe$/.test(name));
      if (uninstaller === undefined) throw new Error('No uninstaller found');
      run(uninstaller, ['/S']);
      break;
    }
    case 'msi': {
      const log = join(tmpdir(), 'msi-install.log');
      try {
        run('msiexec', ['/i', pkg, '/qn', '/norestart', '/l*v', log]);
      } catch (error) {
        // Windows Installer writes its log as UTF-16; the end names the failing action.
        if (existsSync(log)) {
          console.log(readFileSync(log, 'utf16le').split(/\r?\n/).slice(-60).join('\n'));
        }
        throw error;
      }
      const exe = join(
        process.env['ProgramFiles'] ?? 'C:\\Program Files',
        brand.productName,
        `${brand.slug}.exe`,
      );
      checkFuses(exe);
      checkReport(await selfTest(exe), true);
      run('msiexec', ['/x', pkg, '/qn', '/norestart']);
      if (existsSync(exe)) throw new Error('The MSI uninstall left the program behind');
      break;
    }
    case 'dmg': {
      const mount = mkdtempSync(join(tmpdir(), 'dmg-'));
      const target = mkdtempSync(join(tmpdir(), 'apps-'));
      run('hdiutil', ['attach', '-nobrowse', '-readonly', '-mountpoint', mount, pkg]);
      const bundle = find(mount, (name) => name.endsWith('.app'));
      if (bundle === undefined) throw new Error('No app bundle in the disk image');
      run('ditto', [bundle, join(target, `${brand.productName}.app`)]);
      run('hdiutil', ['detach', mount]);
      const app = join(target, `${brand.productName}.app`);
      run('codesign', ['--verify', '--deep', '--strict', app]);
      checkFuses(app);
      const binary = find(join(app, 'Contents', 'MacOS'), (_name, path) => statSync(path).isFile());
      if (binary === undefined) throw new Error('No executable in the app bundle');
      checkReport(await selfTest(binary), true);
      break;
    }
    case 'appimage': {
      run('chmod', ['+x', pkg]);
      installAppImageProfile();
      checkReport(await selfTest(pkg), true);
      break;
    }
    case 'appimage-no-sandbox': {
      // Without the profile on a restricted system, the launcher must open the sandbox help
      // page instead of the browser.
      run('chmod', ['+x', pkg]);
      const report = await selfTest(pkg);
      if (report.mode !== 'sandbox-help') throw new Error('Expected the sandbox help mode');
      break;
    }
    case 'deb': {
      run('sudo', ['apt-get', 'install', '-y', pkg]);
      const exe = `/opt/${brand.productName}/${brand.slug}`;
      checkFuses(exe);
      checkReport(await selfTest(exe), true);
      run('sudo', ['apt-get', 'remove', '-y', brand.slug]);
      break;
    }
    case 'dir': {
      const exe = find(
        pkg,
        (name, path) =>
          (name === brand.slug || name === `${brand.slug}.exe` || name === brand.productName) &&
          statSync(path).isFile(),
      );
      if (exe === undefined) throw new Error('No executable found');
      checkReport(
        await selfTest(
          exe,
          process.platform === 'linux' && process.getuid?.() === 0 ? ['--no-sandbox'] : [],
        ),
        process.getuid?.() !== 0,
      );
      break;
    }
    default:
      throw new Error(`Unknown format ${format}`);
  }
  console.log(`Smoke test passed: ${format}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
