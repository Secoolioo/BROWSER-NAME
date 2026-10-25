import { token, type Token } from '../di/token.ts';
import type { ModuleId, ModuleManifest } from './manifest.ts';
import type { ModuleRegistry } from './registry.ts';

/**
 * Answers whether an optional module is switched on. Implementations combine mandatory
 * policies, settings and safe mode, in that order of precedence.
 */
export interface ActivationSource {
  /**
   * @param manifest - An optional module.
   * @returns `true` or `false` when policy, setting or safe mode decide, or `undefined`
   *   to use the manifest's default.
   */
  isEnabled(manifest: ModuleManifest): boolean | undefined;
}

/** Token for the {@link ActivationSource}. */
export const ActivationSourceToken: Token<ActivationSource> =
  token<ActivationSource>('ActivationSource');

/** Why a module is not active. */
export type InactiveReason =
  { readonly kind: 'disabled' } | { readonly kind: 'dependency'; readonly dependency: ModuleId };

/** The result of {@link resolveActivation}. */
export interface ActivationPlan {
  /** Modules to activate, dependencies first. */
  readonly active: readonly ModuleManifest[];
  /** Modules that stay inactive, with the reason. */
  readonly inactive: ReadonlyMap<ModuleId, InactiveReason>;
}

/**
 * Computes which modules are active and in which order to start them. A module is active
 * if it is core, or switched on and all its dependencies are active.
 * @param registry - The validated module graph.
 * @param source - Decides about optional modules.
 * @param unavailable - Modules treated as inactive regardless of the source, for example
 *   modules that failed to activate.
 */
export function resolveActivation(
  registry: ModuleRegistry,
  source: ActivationSource,
  unavailable: ReadonlySet<ModuleId> = new Set(),
): ActivationPlan {
  const active: ModuleManifest[] = [];
  const activeIds = new Set<ModuleId>();
  const inactive = new Map<ModuleId, InactiveReason>();
  for (const manifest of registry.topologicalOrder()) {
    const wanted =
      manifest.core === true ||
      (source.isEnabled(manifest) ?? manifest.activation?.default ?? false);
    if (!wanted || unavailable.has(manifest.id)) {
      inactive.set(manifest.id, { kind: 'disabled' });
      continue;
    }
    const missing = (manifest.dependsOn ?? []).find((dependency) => !activeIds.has(dependency));
    if (missing !== undefined) {
      inactive.set(manifest.id, { kind: 'dependency', dependency: missing });
      continue;
    }
    active.push(manifest);
    activeIds.add(manifest.id);
  }
  return { active, inactive };
}
