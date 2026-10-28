import { appendFileSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { LogRecord, LogSink } from '../../kernel/logging/logger.ts';

/** Options for a {@link RotatingFileLogSink}. */
export interface RotatingFileLogOptions {
  /** Directory of the log files. */
  readonly directory: string;
  /** Base name; files are `<name>.log`, `<name>.1.log`, ... */
  readonly name: string;
  /** Size at which the current file is rotated. Defaults to 5 MB. */
  readonly maxBytes?: number;
  /** Number of rotated files kept besides the current one. Defaults to 2. */
  readonly keep?: number;
}

/**
 * Writes log records as JSON Lines to a local file and rotates it by size. Logs never
 * leave the device. Write errors are swallowed, because logging must never break the
 * browser.
 */
export class RotatingFileLogSink implements LogSink {
  private readonly file: string;
  private readonly options: Required<RotatingFileLogOptions>;
  private size = -1;

  /** @param options - Location and rotation limits. */
  constructor(options: RotatingFileLogOptions) {
    this.options = { maxBytes: 5 * 1024 * 1024, keep: 2, ...options };
    this.file = this.pathOf(0);
  }

  write(record: LogRecord): void {
    const line = `${JSON.stringify(record)}\n`;
    try {
      if (this.size < 0) {
        mkdirSync(this.options.directory, { recursive: true });
        this.size = fileSize(this.file);
      }
      if (this.size + line.length > this.options.maxBytes && this.size > 0) {
        this.rotate();
      }
      appendFileSync(this.file, line);
      this.size += Buffer.byteLength(line);
    } catch {
      this.size = -1;
    }
  }

  private rotate(): void {
    rmSync(this.pathOf(this.options.keep), { force: true });
    for (let i = this.options.keep - 1; i >= 0; i -= 1) {
      const from = this.pathOf(i);
      if (fileSize(from) > 0) {
        renameSync(from, this.pathOf(i + 1));
      }
    }
    this.size = 0;
  }

  private pathOf(index: number): string {
    return join(
      this.options.directory,
      index === 0 ? `${this.options.name}.log` : `${this.options.name}.${index}.log`,
    );
  }
}

function fileSize(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}
