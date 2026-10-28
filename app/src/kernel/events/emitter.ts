import { toDisposable, type Disposable } from '../../shared/disposable.ts';

/** Receives the values of an {@link Event}. */
export type Listener<T> = (value: T) => void;

/**
 * Subscribes a listener. Services expose their change notifications as events, for
 * example `settings.onDidChange(listener)`.
 * @returns A disposable that removes the listener.
 */
export type Event<T> = (listener: Listener<T>) => Disposable;

/** Options for an {@link Emitter}. */
export interface EmitterOptions {
  /**
   * Called when a listener throws. The remaining listeners still run. Without a handler,
   * the first error is rethrown after all listeners ran.
   */
  readonly onListenerError?: (error: unknown) => void;
}

/**
 * Owns an {@link Event} and fires it. Listeners added or removed while an event is being
 * delivered take effect from the next `fire`.
 */
export class Emitter<T> implements Disposable {
  private listeners: Listener<T>[] = [];
  private disposed = false;
  private readonly onListenerError: ((error: unknown) => void) | undefined;

  /** @param options - Error handling for listeners. */
  constructor(options: EmitterOptions = {}) {
    this.onListenerError = options.onListenerError;
  }

  /** The event that consumers subscribe to. */
  readonly event: Event<T> = (listener) => {
    if (this.disposed) {
      return toDisposable(() => {});
    }
    this.listeners = [...this.listeners, listener];
    return toDisposable(() => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    });
  };

  /** Number of subscribed listeners. */
  get listenerCount(): number {
    return this.listeners.length;
  }

  /**
   * Delivers a value to every listener.
   * @param value - The value to deliver.
   */
  fire(value: T): void {
    let firstError: { error: unknown } | undefined;
    for (const listener of this.listeners) {
      try {
        listener(value);
      } catch (error) {
        if (this.onListenerError !== undefined) {
          this.onListenerError(error);
        } else {
          firstError ??= { error };
        }
      }
    }
    if (firstError !== undefined) {
      throw firstError.error;
    }
  }

  /** Removes all listeners; later subscriptions are ignored. */
  dispose(): void {
    this.disposed = true;
    this.listeners = [];
  }
}
