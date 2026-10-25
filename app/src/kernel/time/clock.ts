import type { Disposable } from '../../shared/disposable.ts';
import { token, type Token } from '../di/token.ts';

/**
 * Source of time and timers. The kernel never touches host timers directly, so tests can
 * drive time deterministically and the kernel stays free of host APIs.
 */
export interface Clock {
  /** Milliseconds from a monotonic clock, suitable for measuring durations. */
  now(): number;
  /** Milliseconds since the Unix epoch, for timestamps. */
  wallTime(): number;
  /**
   * Runs a callback once after a delay.
   * @param callback - Function to run.
   * @param delayMs - Delay in milliseconds.
   * @returns A disposable that cancels the timer.
   */
  setTimeout(callback: () => void, delayMs: number): Disposable;
}

/** Token for the {@link Clock}. */
export const ClockToken: Token<Clock> = token<Clock>('Clock');

/** A timer scheduled on a {@link ManualClock}. */
interface ManualTimer {
  readonly due: number;
  readonly callback: () => void;
  cancelled: boolean;
}

/**
 * A {@link Clock} whose time only moves when {@link ManualClock.advance} is called. Used in
 * tests and for deterministic replays.
 */
export class ManualClock implements Clock {
  private current: number;
  private readonly epoch: number;
  private readonly timers: ManualTimer[] = [];

  /**
   * @param start - Initial monotonic time in milliseconds.
   * @param epoch - Wall time that corresponds to monotonic time 0.
   */
  constructor(start = 0, epoch = 0) {
    this.current = start;
    this.epoch = epoch;
  }

  /** {@inheritDoc Clock.now} */
  now(): number {
    return this.current;
  }

  /** {@inheritDoc Clock.wallTime} */
  wallTime(): number {
    return this.epoch + this.current;
  }

  /** {@inheritDoc Clock.setTimeout} */
  setTimeout(callback: () => void, delayMs: number): Disposable {
    const timer: ManualTimer = {
      due: this.current + Math.max(0, delayMs),
      callback,
      cancelled: false,
    };
    this.timers.push(timer);
    return { dispose: (): void => void (timer.cancelled = true) };
  }

  /**
   * Moves time forward and runs every timer that becomes due, in order of due time.
   * @param ms - Milliseconds to advance.
   */
  advance(ms: number): void {
    const target = this.current + ms;
    for (;;) {
      const next = this.timers
        .filter((t) => !t.cancelled && t.due <= target)
        .toSorted((a, b) => a.due - b.due)[0];
      if (next === undefined) {
        break;
      }
      this.timers.splice(this.timers.indexOf(next), 1);
      this.current = next.due;
      next.callback();
    }
    this.current = target;
  }

  /** Number of timers that are scheduled and not cancelled. */
  get pendingTimers(): number {
    return this.timers.filter((t) => !t.cancelled).length;
  }
}
