import type { Disposable } from '../../shared/disposable.ts';
import { token, type Token } from '../../kernel/di/token.ts';
import { Emitter, type Event } from '../../kernel/events/emitter.ts';
import type { Logger } from '../../kernel/logging/logger.ts';
import type { Clock } from '../../kernel/time/clock.ts';

/** How the browser was installed, which decides who installs updates. */
export type InstallType = 'nsis' | 'msi' | 'mac' | 'appimage' | 'deb' | 'rpm' | 'unpacked';

/**
 * Whether the browser installs updates of this installation type itself. IT updates MSI
 * installations, and the package manager updates deb and rpm installations.
 * @param type - The installation type.
 */
export function updatesItself(type: InstallType): boolean {
  return type === 'nsis' || type === 'mac' || type === 'appimage';
}

/** The `UpdatePolicy` values: off, automatic, or only when the user asks. */
export type UpdateMode = 'off' | 'automatic' | 'manual';

/** What the updater is doing. */
export type UpdateState =
  | { readonly kind: 'disabled'; readonly reason: 'policy' | 'install-type' | 'no-keys' }
  | { readonly kind: 'idle'; readonly lastCheckAt?: number }
  | { readonly kind: 'checking' }
  | { readonly kind: 'downloading'; readonly version: string; readonly percent: number }
  | { readonly kind: 'ready'; readonly version: string }
  | {
      readonly kind: 'failed';
      readonly code: string;
      readonly message: string;
      readonly at: number;
    };

/** Finds, downloads and installs verified updates; electron-updater in the browser. */
export interface UpdateEngine {
  /**
   * Looks for a newer version in the signed feed.
   * @returns The version, or `undefined` when the browser is up to date.
   */
  check(): Promise<string | undefined>;
  /**
   * Downloads the update found by the last check and verifies it.
   * @param onProgress - Receives the progress in percent.
   */
  download(onProgress: (percent: number) => void): Promise<void>;
  /**
   * Starts the silent installation of the downloaded update. Called while the browser
   * exits, after everything is saved.
   */
  install(): void;
}

/** Work around an installation that keeps a rollback possible. */
export interface UpdateHooks {
  /**
   * Runs after a download while the browser keeps running, such as fetching the package of
   * the running version. A failure is logged; the update still installs.
   * @param version - The downloaded version.
   */
  afterDownload(version: string): Promise<void>;
  /**
   * Runs right before the installation starts, while the browser exits.
   * @param version - The version being installed.
   */
  beforeInstall(version: string): void;
}

/** Settings of the update service, resolved from policies and the installation. */
export interface UpdateServiceOptions {
  readonly mode: UpdateMode;
  readonly installType: InstallType;
  /** Whether the build carries update keys; without them, nothing can be verified. */
  readonly hasKeys: boolean;
  /** Minutes between automatic checks. */
  readonly periodMinutes: number;
  readonly isOnline: () => boolean;
  /** Random number in [0, 1) for the jitter; replaceable in tests. */
  readonly random?: () => number;
  /** Rollback preparation around downloads and installations. */
  readonly hooks?: UpdateHooks;
}

const minute = 60_000;
/** The first check waits 30 to 60 seconds, so it never slows down the start. */
const firstCheckDelay = { min: 30_000, spread: 30_000 };
const jitter = 30 * minute;
const offlineRetry = 15 * minute;

/**
 * Checks for updates on a schedule and downloads them in the background. A downloaded
 * update installs when the browser quits. The service never shows a dialog.
 */
export class UpdateService implements Disposable {
  private readonly engine: UpdateEngine;
  private readonly clock: Clock;
  private readonly logger: Logger;
  private readonly options: UpdateServiceOptions;
  private readonly random: () => number;
  private readonly changed = new Emitter<UpdateState>();
  private current: UpdateState;
  private timer: Disposable | undefined;
  private running: Promise<UpdateState> | undefined;

  /** Fires whenever {@link UpdateService.state} changes. */
  readonly onDidChange: Event<UpdateState> = this.changed.event;

  /**
   * @param engine - Finds, downloads and installs updates.
   * @param clock - Time and timers.
   * @param logger - Logger.
   * @param options - Policies and installation facts.
   */
  constructor(engine: UpdateEngine, clock: Clock, logger: Logger, options: UpdateServiceOptions) {
    this.engine = engine;
    this.clock = clock;
    this.logger = logger;
    this.options = options;
    this.random = options.random ?? Math.random;
    this.current = UpdateService.initialState(options);
  }

  private static initialState(options: UpdateServiceOptions): UpdateState {
    if (options.mode === 'off') return { kind: 'disabled', reason: 'policy' };
    if (!updatesItself(options.installType)) return { kind: 'disabled', reason: 'install-type' };
    if (!options.hasKeys) return { kind: 'disabled', reason: 'no-keys' };
    return { kind: 'idle' };
  }

  /** The current state. */
  get state(): UpdateState {
    return this.current;
  }

  /** Schedules the first automatic check, unless updates are off or manual. */
  start(): void {
    if (this.current.kind === 'disabled' || this.options.mode !== 'automatic') return;
    this.schedule(firstCheckDelay.min + this.random() * firstCheckDelay.spread);
  }

  /**
   * Checks now and downloads an update if there is one. Concurrent calls share one run.
   * @returns The state after the run.
   */
  check(): Promise<UpdateState> {
    if (this.current.kind === 'disabled' || this.current.kind === 'ready') {
      return Promise.resolve(this.current);
    }
    this.running ??= this.run().finally(() => {
      this.running = undefined;
    });
    return this.running;
  }

  /**
   * Installs a downloaded update while the browser exits.
   * @returns Whether an installation started.
   */
  installOnExit(): boolean {
    if (this.current.kind !== 'ready') return false;
    this.logger.info('Installing update', { version: this.current.version });
    this.options.hooks?.beforeInstall(this.current.version);
    this.engine.install();
    return true;
  }

  /** Cancels the schedule. */
  dispose(): void {
    this.timer?.dispose();
    this.changed.dispose();
  }

  private schedule(delayMs: number): void {
    this.timer?.dispose();
    this.timer = this.clock.setTimeout(() => {
      this.timer = undefined;
      if (!this.options.isOnline()) {
        this.schedule(Math.min(offlineRetry, this.options.periodMinutes * minute));
        return;
      }
      void this.check().then((state) => {
        if (state.kind !== 'ready' && state.kind !== 'disabled') {
          const period = this.options.periodMinutes * minute;
          this.schedule(Math.max(minute, period + (this.random() * 2 - 1) * jitter));
        }
      });
    }, delayMs);
  }

  private async run(): Promise<UpdateState> {
    this.set({ kind: 'checking' });
    try {
      const version = await this.engine.check();
      if (version === undefined) {
        this.logger.info('No update available');
        return this.set({ kind: 'idle', lastCheckAt: this.clock.wallTime() });
      }
      this.logger.info('Downloading update', { version });
      this.set({ kind: 'downloading', version, percent: 0 });
      await this.engine.download((percent) => {
        this.set({ kind: 'downloading', version, percent: Math.round(percent) });
      });
      try {
        await this.options.hooks?.afterDownload(version);
      } catch (error) {
        this.logger.warn('The rollback could not be prepared', { message: String(error) });
      }
      this.logger.info('Update ready; it installs when the browser quits', { version });
      return this.set({ kind: 'ready', version });
    } catch (error) {
      const code =
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        typeof error.code === 'string'
          ? error.code
          : 'error';
      this.logger.warn('Update failed', { code, message: String(error) });
      return this.set({
        kind: 'failed',
        code,
        message: error instanceof Error ? error.message : String(error),
        at: this.clock.wallTime(),
      });
    }
  }

  private set(state: UpdateState): UpdateState {
    this.current = state;
    this.changed.fire(state);
    return state;
  }
}

/** Token for the {@link UpdateService}. */
export const UpdateServiceToken: Token<UpdateService> = token<UpdateService>('UpdateService');
