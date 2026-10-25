import type { DisposableStore } from '../../shared/disposable.ts';
import type { Container, InjectableClass } from '../di/container.ts';
import type { Logger } from '../logging/logger.ts';

/** Identifier of a feature module, in kebab-case, such as `tab-groups`. */
export type ModuleId = string;

/** Decides whether an optional module is active. */
export interface ModuleActivation {
  /** Setting key that switches the module on or off, such as `workspaces.enabled`. */
  readonly setting?: string;
  /** Policy name that administrators use to force the module on or off. */
  readonly policy?: string;
  /** Whether the module is active when neither policy nor setting decide. */
  readonly default: boolean;
}

/** Everything a module receives when it is activated. */
export interface ModuleContext {
  /** The module's own identifier. */
  readonly id: ModuleId;
  /**
   * The module's child container. Services registered here are private to the module
   * and disposed when it is deactivated.
   */
  readonly services: Container;
  /**
   * Registrations to undo on deactivation: commands, IPC handlers, listeners and UI
   * slots all go here.
   */
  readonly subscriptions: DisposableStore;
  /** A logger scoped to `module.<id>`. */
  readonly logger: Logger;
}

/** The code of a feature module that runs in the browser process. */
export interface FeatureModule {
  /**
   * Starts the module: registers its contributions in `context.subscriptions`.
   * @param context - The module's context.
   */
  activate(context: ModuleContext): void | Promise<void>;
  /** Stops work that subscriptions cannot undo by themselves. Optional. */
  deactivate?(): void | Promise<void>;
  /** Releases resources the module holds outside its subscriptions. Optional. */
  dispose?(): void;
}

/** A feature module class, constructed by the module's container. */
export type FeatureModuleClass = InjectableClass<FeatureModule>;

/**
 * Static description of a feature module. Manifests are tiny and always bundled; the code
 * behind `main` is a separate chunk that is only imported when the module is active.
 */
export interface ModuleManifest {
  readonly id: ModuleId;
  /**
   * Core modules are always active and cannot be switched off. They may only depend on
   * other core modules.
   */
  readonly core?: boolean;
  /** Modules that must be active before this one. */
  readonly dependsOn?: readonly ModuleId[];
  /** How an optional module is switched on and off. Required unless `core` is set. */
  readonly activation?: ModuleActivation;
  /** Whether switching the module on or off only takes effect after a restart. */
  readonly restartRequired?: boolean;
  /** Imports the module's browser-process code. */
  readonly main?: () => Promise<{ readonly default: FeatureModuleClass }>;
}

/** Thrown for invalid manifests and inconsistent module graphs. */
export class ModuleError extends Error {
  override readonly name = 'ModuleError';
}

const idPattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/**
 * Declares a feature module and checks its manifest.
 * @param manifest - The module's static description.
 * @returns The frozen manifest.
 * @throws ModuleError for an invalid id or a missing activation on an optional module.
 */
export function defineModule<const M extends ModuleManifest>(manifest: M): Readonly<M> {
  if (!idPattern.test(manifest.id)) {
    throw new ModuleError(`Module id "${manifest.id}" must be kebab-case`);
  }
  if (manifest.core !== true && manifest.activation === undefined) {
    throw new ModuleError(`Optional module "${manifest.id}" needs an activation`);
  }
  if (manifest.core === true && manifest.activation !== undefined) {
    throw new ModuleError(`Core module "${manifest.id}" cannot be switched off`);
  }
  if (manifest.dependsOn?.includes(manifest.id) === true) {
    throw new ModuleError(`Module "${manifest.id}" depends on itself`);
  }
  return Object.freeze(manifest);
}
