/**
 * Something that holds resources and releases them when {@link Disposable.dispose} is called.
 *
 * Every registration in the browser (a command, an IPC handler, an event listener, a UI
 * slot) returns a `Disposable`, so that a module can be switched off without leaks.
 */
export interface Disposable {
  /** Releases the resources. Calling it more than once has no further effect. */
  dispose(): void;
}

/**
 * Wraps a cleanup function in a {@link Disposable} that runs it at most once.
 * @param cleanup - Function that releases the resource.
 * @returns A disposable that calls `cleanup` on the first `dispose()`.
 */
export function toDisposable(cleanup: () => void): Disposable {
  let disposed = false;
  return {
    dispose(): void {
      if (disposed) {
        return;
      }
      disposed = true;
      cleanup();
    },
  };
}

/**
 * Collects disposables and releases them together, in reverse order of addition.
 *
 * Once disposed, the store disposes anything added later immediately, so late
 * registrations cannot leak.
 */
export class DisposableStore implements Disposable {
  private readonly items: Disposable[] = [];
  private disposed = false;

  /** Whether {@link DisposableStore.dispose} has been called. */
  get isDisposed(): boolean {
    return this.disposed;
  }

  /**
   * Adds a disposable to the store.
   * @param item - The disposable to own.
   * @returns The same disposable, for chaining.
   */
  add<T extends Disposable>(item: T): T {
    if (this.disposed) {
      item.dispose();
    } else {
      this.items.push(item);
    }
    return item;
  }

  /**
   * Disposes every item in reverse order. Errors are collected and rethrown after all
   * items were disposed, so one failing cleanup does not keep others alive.
   * @throws AggregateError when one or more items failed to dispose.
   */
  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    const errors: unknown[] = [];
    for (const item of this.items.splice(0).toReversed()) {
      try {
        item.dispose();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length > 0) {
      throw new AggregateError(errors, 'One or more disposables failed');
    }
  }
}

/**
 * Tells whether a value implements {@link Disposable}.
 * @param value - Any value.
 */
export function isDisposable(value: unknown): value is Disposable {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Partial<Disposable>).dispose === 'function'
  );
}
