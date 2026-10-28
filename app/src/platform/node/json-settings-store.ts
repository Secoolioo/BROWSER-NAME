import { readFile, rename } from 'node:fs/promises';
import type { Disposable } from '../../shared/disposable.ts';
import type { Clock } from '../../kernel/time/clock.ts';
import type {
  RejectedSetting,
  SettingsStore,
  StoredSettings,
} from '../../domain/settings/settings-service.ts';
import { writeFileAtomic } from './atomic-file.ts';

/** Current format version of `settings.json`. */
export const settingsFileVersion = 1;

interface SettingsFile {
  readonly $schemaVersion: number;
  readonly user?: Record<string, unknown>;
  readonly workspaces?: Record<string, Record<string, unknown>>;
}

/**
 * Stores settings in `settings.json` and values that failed validation in
 * `settings.rejected.json`. Writes are atomic and debounced; a corrupt file is moved aside
 * instead of being overwritten.
 */
export class JsonFileSettingsStore implements SettingsStore, Disposable {
  private readonly file: string;
  private readonly rejectedFile: string;
  private readonly clock: Clock;
  private readonly debounceMs: number;
  private pending: { settings: StoredSettings; rejected: readonly RejectedSetting[] } | undefined;
  private timer: Disposable | undefined;
  private waiters: { resolve: () => void; reject: (error: unknown) => void }[] = [];
  private writing: Promise<void> = Promise.resolve();

  /**
   * @param file - Path of `settings.json`.
   * @param rejectedFile - Path of `settings.rejected.json`.
   * @param clock - Schedules debounced writes.
   * @param debounceMs - Delay before a write, so bursts of changes cause one write.
   */
  constructor(file: string, rejectedFile: string, clock: Clock, debounceMs = 300) {
    this.file = file;
    this.rejectedFile = rejectedFile;
    this.clock = clock;
    this.debounceMs = debounceMs;
  }

  async load(): Promise<StoredSettings> {
    let text: string;
    try {
      text = await readFile(this.file, 'utf8');
    } catch {
      return { user: {}, workspaces: {} };
    }
    try {
      const parsed: unknown = JSON.parse(text);
      if (!isRecord(parsed)) {
        throw new Error('settings.json is not an object');
      }
      const workspaces = isRecord(parsed['workspaces']) ? parsed['workspaces'] : {};
      return {
        user: isRecord(parsed['user']) ? parsed['user'] : {},
        workspaces: Object.fromEntries(
          Object.entries(workspaces).filter((entry): entry is [string, Record<string, unknown>] =>
            isRecord(entry[1]),
          ),
        ),
      };
    } catch {
      await rename(this.file, `${this.file}.corrupt-${this.clock.wallTime()}`).catch(
        () => undefined,
      );
      return { user: {}, workspaces: {} };
    }
  }

  save(settings: StoredSettings, rejected: readonly RejectedSetting[]): Promise<void> {
    this.pending = { settings, rejected };
    this.timer?.dispose();
    this.timer = this.clock.setTimeout(() => void this.flush(), this.debounceMs);
    return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
  }

  /** Writes a pending change now, for example during shutdown. */
  flush(): Promise<void> {
    this.timer?.dispose();
    this.timer = undefined;
    const pending = this.pending;
    const waiters = this.waiters.splice(0);
    this.pending = undefined;
    if (pending === undefined) {
      return this.writing;
    }
    this.writing = this.writing
      .then(() => this.write(pending.settings, pending.rejected))
      .then(
        () => waiters.forEach((w) => w.resolve()),
        (error: unknown) => waiters.forEach((w) => w.reject(error)),
      );
    return this.writing;
  }

  /** Cancels a scheduled write without writing it. Call {@link JsonFileSettingsStore.flush} first. */
  dispose(): void {
    this.timer?.dispose();
  }

  private async write(
    settings: StoredSettings,
    rejected: readonly RejectedSetting[],
  ): Promise<void> {
    const file: SettingsFile = {
      $schemaVersion: settingsFileVersion,
      user: sortKeys(settings.user),
      workspaces: Object.fromEntries(
        Object.entries(settings.workspaces).map(([id, values]) => [id, sortKeys(values)]),
      ),
    };
    await writeFileAtomic(this.file, `${JSON.stringify(file, null, 2)}\n`);
    if (rejected.length > 0) {
      await writeFileAtomic(this.rejectedFile, `${JSON.stringify(rejected, null, 2)}\n`);
    }
  }
}

function sortKeys(values: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(values).toSorted(([a], [b]) => a.localeCompare(b)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
