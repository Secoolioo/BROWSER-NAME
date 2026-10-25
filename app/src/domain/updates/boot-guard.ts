import { token, type Token } from '../../kernel/di/token.ts';

/** What the boot guard remembers between starts, in `boot-state.json`. */
export interface BootState {
  /** An installed update that has not proven itself yet. */
  readonly pending?: {
    readonly version: string;
    readonly previous: string;
    /** Starts of the new version so far. */
    readonly attempts: number;
  };
  /** Versions that failed to start; they are never installed again. */
  readonly blocked: readonly string[];
}

/** Reads and writes the boot state. */
export interface BootStateStore {
  read(): BootState;
  write(state: BootState): void;
}

/** What the browser does at this start. */
export type BootDecision =
  | { readonly kind: 'normal' }
  | { readonly kind: 'trial'; readonly attempt: number }
  | { readonly kind: 'rollback'; readonly failed: string; readonly previous: string };

/**
 * Rolls back an update that keeps failing to start. The working version records the update
 * before it installs it; the new version counts its starts from its first lines and clears
 * the record once it is healthy. When the new version has failed its allowed starts, the
 * guard asks for the previous version and blocks the failed one.
 */
export class BootGuard {
  private readonly store: BootStateStore;
  private readonly maxAttempts: number;

  /**
   * @param store - Where the state lives.
   * @param maxAttempts - Failed starts before a rollback.
   */
  constructor(store: BootStateStore, maxAttempts = 2) {
    this.store = store;
    this.maxAttempts = maxAttempts;
  }

  /**
   * Records an update that is about to be installed. Called by the working version.
   * @param from - The running version.
   * @param to - The version being installed.
   */
  prepareUpdate(from: string, to: string): void {
    const state = this.store.read();
    this.store.write({ ...state, pending: { version: to, previous: from, attempts: 0 } });
  }

  /**
   * Decides how this start proceeds. Called first thing in the main process.
   * @param version - The running version.
   */
  beginBoot(version: string): BootDecision {
    const state = this.store.read();
    const pending = state.pending;
    if (pending === undefined) return { kind: 'normal' };
    if (pending.version !== version) {
      // The update was not applied, or the previous version is back: nothing to watch.
      this.store.write({ blocked: state.blocked });
      return { kind: 'normal' };
    }
    const attempt = pending.attempts + 1;
    if (attempt > this.maxAttempts) {
      this.store.write({ blocked: [...new Set([...state.blocked, version])] });
      return { kind: 'rollback', failed: version, previous: pending.previous };
    }
    this.store.write({ ...state, pending: { ...pending, attempts: attempt } });
    return { kind: 'trial', attempt };
  }

  /**
   * Marks the running version as healthy, which ends the trial.
   * @param version - The running version.
   */
  markHealthy(version: string): void {
    const state = this.store.read();
    if (state.pending?.version === version) {
      this.store.write({ blocked: state.blocked });
    }
  }

  /** Versions that failed to start and must not be installed again. */
  blockedVersions(): readonly string[] {
    return this.store.read().blocked;
  }
}

/** Token for the {@link BootGuard}. */
export const BootGuardToken: Token<BootGuard> = token<BootGuard>('BootGuard');
