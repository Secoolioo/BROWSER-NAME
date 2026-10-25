import type { Disposable } from '../../shared/disposable.ts';
import { token, type Token } from '../di/token.ts';
import { Emitter, type Event } from '../events/emitter.ts';
import { LoggerToken, type Logger } from '../logging/logger.ts';
import { ClockToken, type Clock } from '../time/clock.ts';

/**
 * Phases of the browser process, in order:
 * - `starting`: policies and settings load, the first window is being created.
 * - `ready`: the first window shows its shell.
 * - `running`: deferred work after the first paint has started.
 * - `shutting-down`: participants finish their work.
 * - `stopped`: the process may exit.
 */
export type LifecyclePhase = 'starting' | 'ready' | 'running' | 'shutting-down' | 'stopped';

const order: readonly LifecyclePhase[] = [
  'starting',
  'ready',
  'running',
  'shutting-down',
  'stopped',
];

/** Why the browser shuts down. */
export type ShutdownReason = 'quit' | 'restart' | 'update';

/** Passed to shutdown participants. */
export interface ShutdownEvent {
  readonly reason: ShutdownReason;
  /**
   * Delays the shutdown until the work settles or the shutdown timeout elapses.
   * @param work - Promise of the work to finish, such as saving the session.
   * @param label - Name for logs if the work fails or is too slow.
   */
  join(work: Promise<unknown>, label: string): void;
}

/** Options for the {@link Lifecycle}. */
export interface LifecycleOptions {
  /** How long shutdown waits for joined work. Defaults to 5000 ms. */
  readonly shutdownTimeoutMs?: number;
}

/** Token for the {@link Lifecycle}. */
export const LifecycleToken: Token<Lifecycle> = token<Lifecycle>('Lifecycle');

/** Token for the {@link LifecycleOptions}. */
export const LifecycleOptionsToken: Token<LifecycleOptions> =
  token<LifecycleOptions>('LifecycleOptions');

/**
 * Tracks the phase of the browser process and coordinates an orderly shutdown in which
 * every participant can finish its work within a time limit.
 */
export class Lifecycle implements Disposable {
  static readonly inject = [LoggerToken, ClockToken, LifecycleOptionsToken] as const;

  private current: LifecyclePhase = 'starting';
  private readonly phaseEmitter = new Emitter<LifecyclePhase>();
  private readonly shutdownEmitter: Emitter<ShutdownEvent>;
  private readonly waiting = new Map<LifecyclePhase, (() => void)[]>();
  private shutdownPromise: Promise<void> | undefined;
  private readonly logger: Logger;
  private readonly clock: Clock;
  private readonly timeoutMs: number;

  /** Fires after the phase changed. */
  readonly onDidChangePhase: Event<LifecyclePhase> = this.phaseEmitter.event;

  /** Fires when shutdown begins; listeners may join work. */
  readonly onWillShutdown: Event<ShutdownEvent>;

  /**
   * @param logger - Receives failures of shutdown participants.
   * @param clock - Provides the shutdown timeout.
   * @param options - Timeout configuration.
   */
  constructor(logger: Logger, clock: Clock, options: LifecycleOptions) {
    this.logger = logger.child('lifecycle');
    this.clock = clock;
    this.timeoutMs = options.shutdownTimeoutMs ?? 5000;
    this.shutdownEmitter = new Emitter<ShutdownEvent>({
      onListenerError: (error) => this.logger.error('Shutdown listener failed', error),
    });
    this.onWillShutdown = this.shutdownEmitter.event;
  }

  /** The current phase. */
  get phase(): LifecyclePhase {
    return this.current;
  }

  /**
   * Resolves once the given phase is reached. Resolves immediately if it has passed.
   * @param phase - The phase to wait for.
   */
  when(phase: LifecyclePhase): Promise<void> {
    if (this.reached(phase)) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const list = this.waiting.get(phase) ?? [];
      list.push(resolve);
      this.waiting.set(phase, list);
    });
  }

  /**
   * Moves to a later phase. Use {@link Lifecycle.shutdown} to leave `running`.
   * @param phase - `ready` or `running`.
   * @throws Error when the phase is not later than the current one, or is a shutdown phase.
   */
  advance(phase: 'ready' | 'running'): void {
    if (order.indexOf(phase) <= order.indexOf(this.current)) {
      throw new Error(`Cannot move from ${this.current} to ${phase}`);
    }
    this.setPhase(phase);
  }

  /**
   * Shuts down: notifies participants, waits for joined work up to the timeout, then
   * moves to `stopped`. Calling it again returns the same promise.
   * @param reason - Why the browser shuts down.
   */
  shutdown(reason: ShutdownReason): Promise<void> {
    this.shutdownPromise ??= this.runShutdown(reason);
    return this.shutdownPromise;
  }

  /** Removes all listeners. */
  dispose(): void {
    this.phaseEmitter.dispose();
    this.shutdownEmitter.dispose();
  }

  private async runShutdown(reason: ShutdownReason): Promise<void> {
    this.setPhase('shutting-down');
    const joined: Promise<void>[] = [];
    this.shutdownEmitter.fire({
      reason,
      join: (work, label) => {
        joined.push(
          work.then(
            () => undefined,
            (error: unknown) => this.logger.error(`Shutdown work failed: ${label}`, error),
          ),
        );
      },
    });
    if (joined.length > 0) {
      let timer: Disposable | undefined;
      const timeout = new Promise<'timeout'>((resolve) => {
        timer = this.clock.setTimeout(() => resolve('timeout'), this.timeoutMs);
      });
      const outcome = await Promise.race([
        Promise.all(joined).then(() => 'done' as const),
        timeout,
      ]);
      timer?.dispose();
      if (outcome === 'timeout') {
        this.logger.warn('Shutdown timed out', { timeoutMs: this.timeoutMs, reason });
      }
    }
    this.setPhase('stopped');
  }

  private reached(phase: LifecyclePhase): boolean {
    return order.indexOf(this.current) >= order.indexOf(phase);
  }

  private setPhase(phase: LifecyclePhase): void {
    this.current = phase;
    for (const [waitingFor, resolvers] of this.waiting) {
      if (this.reached(waitingFor)) {
        this.waiting.delete(waitingFor);
        for (const resolve of resolvers) {
          resolve();
        }
      }
    }
    this.phaseEmitter.fire(phase);
  }
}
