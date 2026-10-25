import { DisposableStore, type Disposable } from '../../shared/disposable.ts';
import type { Container } from '../di/container.ts';
import { token, type Token } from '../di/token.ts';
import { Emitter, type Event } from '../events/emitter.ts';
import { LoggerToken, describeError, type Logger } from '../logging/logger.ts';
import { ClockToken, type Clock } from '../time/clock.ts';
import {
  ActivationSourceToken,
  resolveActivation,
  type ActivationSource,
  type InactiveReason,
} from './activation.ts';
import type { FeatureModule, ModuleId, ModuleManifest } from './manifest.ts';
import { ModuleError } from './manifest.ts';
import { ModuleRegistryToken, type ModuleRegistry } from './registry.ts';

/** State of a module in the {@link ModuleHost}. */
export type ModuleState = 'inactive' | 'active' | 'failed' | 'restart-required';

/** Status of one module, as shown on the diagnostics page. */
export interface ModuleStatus {
  readonly id: ModuleId;
  readonly state: ModuleState;
  /** Why the module is inactive. */
  readonly reason?: InactiveReason;
  /** Time spent importing the module's code, in milliseconds. */
  readonly loadMs?: number;
  /** Time spent in `activate`, in milliseconds. */
  readonly activateMs?: number;
  /** Message of the error that made the module fail. */
  readonly error?: string;
}

interface Running {
  readonly manifest: ModuleManifest;
  readonly instance: FeatureModule | undefined;
  readonly services: Container;
  readonly subscriptions: DisposableStore;
}

/** Token for the container that module containers are created from. */
export const ModuleParentContainerToken: Token<Container> =
  token<Container>('ModuleParentContainer');

/** Token for the {@link ModuleHost}. */
export const ModuleHostToken: Token<ModuleHost> = token<ModuleHost>('ModuleHost');

/**
 * Activates and deactivates feature modules. Only active modules have their code
 * imported; a module that fails is isolated and its dependents stay inactive. A failing
 * core module stops the start.
 */
export class ModuleHost implements Disposable {
  static readonly inject = [
    ModuleRegistryToken,
    ActivationSourceToken,
    ModuleParentContainerToken,
    LoggerToken,
    ClockToken,
  ] as const;

  private readonly running = new Map<ModuleId, Running>();
  private readonly statuses = new Map<ModuleId, ModuleStatus>();
  private readonly failed = new Set<ModuleId>();
  private readonly statusEmitter = new Emitter<ModuleStatus>();
  private readonly registry: ModuleRegistry;
  private readonly source: ActivationSource;
  private readonly parent: Container;
  private readonly logger: Logger;
  private readonly clock: Clock;
  private started = false;
  private applied = false;
  private queue: Promise<void> = Promise.resolve();

  /** Fires when the status of a module changes. */
  readonly onDidChangeStatus: Event<ModuleStatus> = this.statusEmitter.event;

  /**
   * @param registry - The module graph.
   * @param source - Decides about optional modules.
   * @param parent - Container that module containers are children of.
   * @param logger - Parent logger; modules get `module.<id>` loggers.
   * @param clock - Measures load and activation times.
   */
  constructor(
    registry: ModuleRegistry,
    source: ActivationSource,
    parent: Container,
    logger: Logger,
    clock: Clock,
  ) {
    this.registry = registry;
    this.source = source;
    this.parent = parent;
    this.logger = logger;
    this.clock = clock;
  }

  /**
   * Activates every module of the activation plan, dependencies first.
   * @throws ModuleError when a core module fails to activate.
   */
  start(): Promise<void> {
    if (this.started) {
      return this.queue;
    }
    this.started = true;
    return this.enqueue(() => this.apply());
  }

  /**
   * Re-evaluates the activation source after a setting or policy changed. Modules that
   * became inactive are deactivated in reverse order; new ones are activated. Modules
   * that require a restart only change their status.
   */
  refresh(): Promise<void> {
    return this.enqueue(() => this.apply());
  }

  /** Deactivates every active module in reverse activation order. */
  stop(): Promise<void> {
    return this.enqueue(async () => {
      for (const id of [...this.running.keys()].toReversed()) {
        await this.deactivate(id, { kind: 'disabled' });
      }
    });
  }

  /**
   * Tells whether a module is active.
   * @param id - The module id.
   */
  isActive(id: ModuleId): boolean {
    return this.running.has(id);
  }

  /** Status of every registered module, in registration order. */
  status(): readonly ModuleStatus[] {
    return this.registry
      .all()
      .map((m) => this.statuses.get(m.id) ?? { id: m.id, state: 'inactive' as const });
  }

  /** Disposes all module containers without awaiting `deactivate`. Prefer {@link ModuleHost.stop}. */
  dispose(): void {
    for (const id of [...this.running.keys()].toReversed()) {
      this.release(id);
    }
    this.statusEmitter.dispose();
  }

  private enqueue(work: () => Promise<void>): Promise<void> {
    const next = this.queue.then(work);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async apply(): Promise<void> {
    const initial = !this.applied;
    this.applied = true;
    const plan = resolveActivation(this.registry, this.source, this.failed);
    const wanted = new Set(plan.active.map((m) => m.id));
    for (const [id, entry] of [...this.running].toReversed()) {
      if (wanted.has(id)) {
        continue;
      }
      if (entry.manifest.restartRequired === true) {
        this.setStatus({ id, state: 'restart-required' });
      } else {
        await this.deactivate(id, plan.inactive.get(id) ?? { kind: 'disabled' });
      }
    }
    for (const manifest of plan.active) {
      if (this.running.has(manifest.id)) {
        continue;
      }
      if (manifest.restartRequired === true && !initial) {
        this.setStatus({ id: manifest.id, state: 'restart-required' });
        continue;
      }
      const missing = (manifest.dependsOn ?? []).find((d) => !this.running.has(d));
      if (missing !== undefined) {
        this.setStatus({
          id: manifest.id,
          state: 'inactive',
          reason: { kind: 'dependency', dependency: missing },
        });
        continue;
      }
      await this.activate(manifest);
    }
    for (const [id, reason] of plan.inactive) {
      const state = this.statuses.get(id)?.state;
      if (!this.running.has(id) && state !== 'failed') {
        this.setStatus({ id, state: 'inactive', reason });
      }
    }
  }

  private async activate(manifest: ModuleManifest): Promise<void> {
    const services = this.parent.createChild();
    const subscriptions = new DisposableStore();
    const logger = this.logger.child(`module.${manifest.id}`);
    const started = this.clock.now();
    let loadMs = 0;
    try {
      let instance: FeatureModule | undefined;
      if (manifest.main !== undefined) {
        const loaded = await manifest.main();
        loadMs = this.clock.now() - started;
        instance = services.instantiate(loaded.default);
        await instance.activate({ id: manifest.id, services, subscriptions, logger });
      }
      this.running.set(manifest.id, { manifest, instance, services, subscriptions });
      this.setStatus({
        id: manifest.id,
        state: 'active',
        loadMs,
        activateMs: this.clock.now() - started - loadMs,
      });
    } catch (error) {
      safely(() => subscriptions.dispose());
      safely(() => services.dispose());
      this.failed.add(manifest.id);
      this.setStatus({ id: manifest.id, state: 'failed', error: describeError(error).message });
      this.logger.error(`Module ${manifest.id} failed to activate`, error);
      if (manifest.core === true) {
        throw new ModuleError(`Core module "${manifest.id}" failed to activate`, { cause: error });
      }
    }
  }

  private async deactivate(id: ModuleId, reason: InactiveReason): Promise<void> {
    const entry = this.running.get(id);
    if (entry === undefined) {
      return;
    }
    try {
      await entry.instance?.deactivate?.();
    } catch (error) {
      this.logger.error(`Module ${id} failed to deactivate`, error);
    }
    this.release(id);
    this.setStatus({ id, state: 'inactive', reason });
  }

  private release(id: ModuleId): void {
    const entry = this.running.get(id);
    if (entry === undefined) {
      return;
    }
    this.running.delete(id);
    safely(
      () => entry.subscriptions.dispose(),
      (e) => this.logger.error(`Module ${id} cleanup failed`, e),
    );
    safely(
      () => entry.services.dispose(),
      (e) => this.logger.error(`Module ${id} cleanup failed`, e),
    );
  }

  private setStatus(status: ModuleStatus): void {
    this.statuses.set(status.id, status);
    this.statusEmitter.fire(status);
  }
}

function safely(work: () => void, onError: (error: unknown) => void = () => {}): void {
  try {
    work();
  } catch (error) {
    onError(error);
  }
}
