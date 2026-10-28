import { token, type Token } from '../di/token.ts';
import type { Clock } from '../time/clock.ts';

/** Severity of a log record, from most to least verbose. */
export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error';

const severity: Readonly<Record<LogLevel, number>> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
};

/** Structured context attached to a log record. Values must be JSON-serializable. */
export type LogFields = Readonly<Record<string, unknown>>;

/** One log entry. Records stay on the device; nothing is ever uploaded. */
export interface LogRecord {
  /** Wall time in milliseconds since the Unix epoch. */
  readonly time: number;
  readonly level: LogLevel;
  /** Dotted origin, such as `kernel.modules` or `module.workspaces`. */
  readonly scope: string;
  readonly message: string;
  readonly fields?: LogFields;
  /** Name, message and stack of an error, if one was logged. */
  readonly error?: { readonly name: string; readonly message: string; readonly stack?: string };
}

/** Writes log records somewhere, for example to a rotating file or a memory buffer. */
export interface LogSink {
  /** @param record - The record to write. */
  write(record: LogRecord): void;
}

/** Structured logging API used by the kernel, the domain and every module. */
export interface Logger {
  /** Scope of this logger. */
  readonly scope: string;
  /** @param level - A level. @returns Whether records of that level are written. */
  isEnabled(level: LogLevel): boolean;
  /** Logs very detailed diagnostics. */
  trace(message: string, fields?: LogFields): void;
  /** Logs diagnostics for developers. */
  debug(message: string, fields?: LogFields): void;
  /** Logs a normal, noteworthy event. */
  info(message: string, fields?: LogFields): void;
  /** Logs an unexpected condition that the browser recovered from. */
  warn(message: string, fields?: LogFields): void;
  /** Logs a failure, with the error that caused it. */
  error(message: string, error?: unknown, fields?: LogFields): void;
  /**
   * Creates a logger for a sub-scope that writes to the same sink.
   * @param scope - Appended to this logger's scope with a dot.
   */
  child(scope: string): Logger;
}

/** Token for the root {@link Logger}. */
export const LoggerToken: Token<Logger> = token<Logger>('Logger');

/** Options for a {@link SinkLogger}. */
export interface SinkLoggerOptions {
  readonly scope: string;
  /** Records below this level are dropped. Defaults to `info`. */
  readonly level?: LogLevel;
}

/** A {@link Logger} that filters by level and writes records to a {@link LogSink}. */
export class SinkLogger implements Logger {
  readonly scope: string;
  private readonly sink: LogSink;
  private readonly clock: Clock;
  private readonly level: LogLevel;

  /**
   * @param sink - Destination of the records.
   * @param clock - Source of timestamps.
   * @param options - Scope and minimum level.
   */
  constructor(sink: LogSink, clock: Clock, options: SinkLoggerOptions) {
    this.sink = sink;
    this.clock = clock;
    this.scope = options.scope;
    this.level = options.level ?? 'info';
  }

  /** {@inheritDoc Logger.isEnabled} */
  isEnabled(level: LogLevel): boolean {
    return severity[level] >= severity[this.level];
  }

  /** {@inheritDoc Logger.trace} */
  trace(message: string, fields?: LogFields): void {
    this.write('trace', message, fields);
  }

  /** {@inheritDoc Logger.debug} */
  debug(message: string, fields?: LogFields): void {
    this.write('debug', message, fields);
  }

  /** {@inheritDoc Logger.info} */
  info(message: string, fields?: LogFields): void {
    this.write('info', message, fields);
  }

  /** {@inheritDoc Logger.warn} */
  warn(message: string, fields?: LogFields): void {
    this.write('warn', message, fields);
  }

  /** {@inheritDoc Logger.error} */
  error(message: string, error?: unknown, fields?: LogFields): void {
    this.write('error', message, fields, error);
  }

  /** {@inheritDoc Logger.child} */
  child(scope: string): Logger {
    return new SinkLogger(this.sink, this.clock, {
      scope: `${this.scope}.${scope}`,
      level: this.level,
    });
  }

  private write(level: LogLevel, message: string, fields?: LogFields, error?: unknown): void {
    if (!this.isEnabled(level)) {
      return;
    }
    this.sink.write({
      time: this.clock.wallTime(),
      level,
      scope: this.scope,
      message,
      ...(fields === undefined ? {} : { fields }),
      ...(error === undefined ? {} : { error: describeError(error) }),
    });
  }
}

/**
 * Converts any thrown value into the serializable error shape of a {@link LogRecord}.
 * @param error - A thrown value.
 */
export function describeError(error: unknown): NonNullable<LogRecord['error']> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      ...(error.stack === undefined ? {} : { stack: error.stack }),
    };
  }
  return { name: 'NonError', message: String(error) };
}

/**
 * Keeps the most recent records in memory, for the diagnostics page and for tests.
 */
export class RingBufferLogSink implements LogSink {
  private readonly buffer: LogRecord[] = [];
  private readonly capacity: number;

  /** @param capacity - Maximum number of records kept. */
  constructor(capacity = 1000) {
    this.capacity = capacity;
  }

  /** {@inheritDoc LogSink.write} */
  write(record: LogRecord): void {
    this.buffer.push(record);
    if (this.buffer.length > this.capacity) {
      this.buffer.shift();
    }
  }

  /** The kept records, oldest first. */
  get records(): readonly LogRecord[] {
    return this.buffer;
  }
}

/** Writes every record to several sinks. */
export class FanOutLogSink implements LogSink {
  private readonly sinks: readonly LogSink[];

  /** @param sinks - Destinations; each receives every record. */
  constructor(sinks: readonly LogSink[]) {
    this.sinks = sinks;
  }

  /** {@inheritDoc LogSink.write} */
  write(record: LogRecord): void {
    for (const sink of this.sinks) {
      sink.write(record);
    }
  }
}
