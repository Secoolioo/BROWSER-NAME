import { performance } from 'node:perf_hooks';
import type { Disposable } from '../../shared/disposable.ts';
import type { Clock } from '../../kernel/time/clock.ts';

/** {@link Clock} backed by the host's monotonic clock and timers. */
export class SystemClock implements Clock {
  now(): number {
    return performance.now();
  }

  wallTime(): number {
    return Date.now();
  }

  setTimeout(callback: () => void, delayMs: number): Disposable {
    const handle = setTimeout(callback, delayMs);
    handle.unref();
    return { dispose: (): void => clearTimeout(handle) };
  }
}
