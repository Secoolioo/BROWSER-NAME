import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { InstallType } from '../../domain/updates/update-service.ts';

/** Keeps the running version so that a failed update can be undone without the network. */
export interface Rollback {
  /**
   * Fetches what a rollback needs while the browser runs, after an update was downloaded.
   * @param version - The running version.
   * @param download - Fetches the package of a version.
   */
  prepare(version: string, download: PackageDownloader): Promise<void>;
  /** Keeps the running version, right before the update installs. */
  keep(): void;
  /**
   * Brings the previous version back and starts it.
   * @param args - Command line arguments for the restored version, where it can take them.
   * @returns Whether the previous version could be restored.
   */
  restore(args: readonly string[]): boolean;
}

/** Starts a program detached from the browser. */
export type Launcher = (file: string, args: readonly string[]) => void;

const launchDetached: Launcher = (file, args) => {
  spawn(file, args, { detached: true, stdio: 'ignore' }).unref();
};

/** Streams the package of a version, with its SHA-512 from the signed manifest. */
export type PackageDownloader = (version: string) => Promise<{
  readonly sha512: string;
  readonly chunks: AsyncIterable<Uint8Array>;
}>;

/**
 * The per-user folder for update state, next to electron-updater's cache. It belongs to the
 * installation, not to a profile.
 * @param slug - Product slug.
 * @param env - Environment variables.
 * @param platform - The operating system.
 */
export function updaterDirectory(
  slug: string,
  env: Readonly<Record<string, string | undefined>>,
  platform: NodeJS.Platform,
): string {
  const base =
    platform === 'win32'
      ? (env['LOCALAPPDATA'] ?? join(homedir(), 'AppData', 'Local'))
      : platform === 'darwin'
        ? join(homedir(), 'Library', 'Caches')
        : (env['XDG_CACHE_HOME'] ?? join(homedir(), '.cache'));
  return join(base, `${slug}-updater`);
}

/** An AppImage keeps a copy of itself and swaps it back. */
export class AppImageRollback implements Rollback {
  private readonly appImage: string;
  private readonly previous: string;
  private readonly launch: Launcher;

  /**
   * @param appImage - The running AppImage file.
   * @param directory - Where the copy is kept.
   * @param launch - Starts the restored version.
   */
  constructor(appImage: string, directory: string, launch: Launcher = launchDetached) {
    this.appImage = appImage;
    this.previous = join(directory, 'previous.AppImage');
    this.launch = launch;
  }

  prepare(): Promise<void> {
    return Promise.resolve();
  }

  keep(): void {
    mkdirSync(join(this.previous, '..'), { recursive: true });
    copyFileSync(this.appImage, this.previous);
  }

  restore(args: readonly string[]): boolean {
    if (!existsSync(this.previous)) return false;
    // The running AppImage stays mounted from its old inode, so the swap is safe.
    const temporary = `${this.appImage}.restore`;
    copyFileSync(this.previous, temporary);
    renameSync(temporary, this.appImage);
    this.launch(this.appImage, args);
    return true;
  }
}

/**
 * An NSIS installation keeps the installer of the running version, verified against the
 * signed feed, and reinstalls it silently.
 */
export class NsisRollback implements Rollback {
  private readonly directory: string;
  private readonly launch: Launcher;

  /**
   * @param directory - Where the installer is kept.
   * @param launch - Starts the installer.
   */
  constructor(directory: string, launch: Launcher = launchDetached) {
    this.directory = directory;
    this.launch = launch;
  }

  private installerFor(version: string): string {
    return join(this.directory, `installer-${version}.exe`);
  }

  async prepare(version: string, download: PackageDownloader): Promise<void> {
    const target = this.installerFor(version);
    if (existsSync(target)) return;
    mkdirSync(this.directory, { recursive: true });
    const { sha512, chunks } = await download(version);
    const hash = createHash('sha512');
    const part = `${target}.part`;
    const fd = openSync(part, 'w');
    try {
      for await (const chunk of chunks) {
        hash.update(chunk);
        writeSync(fd, chunk);
      }
    } finally {
      closeSync(fd);
    }
    if (hash.digest('base64') !== sha512) {
      rmSync(part, { force: true });
      throw new Error(`The installer of ${version} does not match its manifest`);
    }
    for (const name of readdirSync(this.directory)) {
      if (/^installer-.*\.exe$/.test(name)) rmSync(join(this.directory, name), { force: true });
    }
    renameSync(part, target);
    writeFileSync(join(this.directory, 'installer.json'), JSON.stringify({ version }));
  }

  keep(): void {
    // The installer was fetched by `prepare`; nothing to copy while exiting.
  }

  /**
   * Reinstalls the previous version silently; the installer starts it afterwards, without
   * arguments.
   * @param _args - Not used, because the installer starts the browser.
   * @returns Whether an installer of the previous version was found.
   */
  restore(_args: readonly string[]): boolean {
    let version: unknown;
    try {
      const record: unknown = JSON.parse(
        readFileSync(join(this.directory, 'installer.json'), 'utf8'),
      );
      version =
        typeof record === 'object' && record !== null && 'version' in record
          ? record.version
          : undefined;
    } catch {
      return false;
    }
    if (typeof version !== 'string') return false;
    const installer = this.installerFor(version);
    if (!existsSync(installer)) return false;
    // A silent reinstall closes this process and starts the restored version afterwards.
    this.launch(installer, ['/S', '--updated', '--force-run']);
    return true;
  }
}

/**
 * Picks the rollback for an installation type; other types are updated by IT or the
 * package manager, or have no automatic rollback yet.
 * @param type - The installation type.
 * @param options - Where rollback files live and the running AppImage, if any.
 */
export function rollbackFor(
  type: InstallType,
  options: { readonly directory: string; readonly appImage: string | undefined },
): Rollback | undefined {
  if (type === 'appimage' && options.appImage !== undefined) {
    return new AppImageRollback(options.appImage, options.directory);
  }
  if (type === 'nsis') return new NsisRollback(options.directory);
  return undefined;
}
