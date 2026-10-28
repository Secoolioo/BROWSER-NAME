import { token, type Token } from '../di/token.ts';
import { ModuleError, type ModuleId, type ModuleManifest } from './manifest.ts';

/**
 * Holds every known module manifest and checks the module graph: unique ids, known
 * dependencies, no cycles, and core modules that only depend on core modules.
 */
export class ModuleRegistry {
  private readonly manifests = new Map<ModuleId, ModuleManifest>();

  /**
   * @param manifests - Manifests in registration order. The order breaks ties when the
   *   activation order is computed, so it stays deterministic.
   * @throws ModuleError when the graph is invalid.
   */
  constructor(manifests: readonly ModuleManifest[]) {
    for (const manifest of manifests) {
      if (this.manifests.has(manifest.id)) {
        throw new ModuleError(`Module "${manifest.id}" is registered twice`);
      }
      this.manifests.set(manifest.id, manifest);
    }
    for (const manifest of manifests) {
      for (const dependency of manifest.dependsOn ?? []) {
        const target = this.manifests.get(dependency);
        if (target === undefined) {
          throw new ModuleError(`Module "${manifest.id}" depends on unknown "${dependency}"`);
        }
        if (manifest.core === true && target.core !== true) {
          throw new ModuleError(
            `Core module "${manifest.id}" cannot depend on optional "${dependency}"`,
          );
        }
      }
    }
    this.topologicalOrder();
  }

  /** All manifests in registration order. */
  all(): readonly ModuleManifest[] {
    return [...this.manifests.values()];
  }

  /**
   * Looks up a manifest.
   * @param id - The module id.
   */
  get(id: ModuleId): ModuleManifest | undefined {
    return this.manifests.get(id);
  }

  /**
   * Orders all modules so that every module comes after its dependencies. Ties keep the
   * registration order.
   * @throws ModuleError on a dependency cycle.
   */
  topologicalOrder(): readonly ModuleManifest[] {
    const done = new Set<ModuleId>();
    const path: ModuleId[] = [];
    const result: ModuleManifest[] = [];
    const visit = (manifest: ModuleManifest): void => {
      if (done.has(manifest.id)) {
        return;
      }
      if (path.includes(manifest.id)) {
        throw new ModuleError(`Module dependency cycle: ${[...path, manifest.id].join(' -> ')}`);
      }
      path.push(manifest.id);
      for (const dependency of manifest.dependsOn ?? []) {
        const target = this.manifests.get(dependency);
        if (target !== undefined) {
          visit(target);
        }
      }
      path.pop();
      done.add(manifest.id);
      result.push(manifest);
    };
    for (const manifest of this.manifests.values()) {
      visit(manifest);
    }
    return result;
  }
}

/** Token for the {@link ModuleRegistry}. */
export const ModuleRegistryToken: Token<ModuleRegistry> = token<ModuleRegistry>('ModuleRegistry');
