import type { Disposable } from '../../shared/disposable.ts';
import { err, ok, type Result } from '../../shared/result.ts';
import { token, type Token } from '../../kernel/di/token.ts';
import { Emitter, type Event } from '../../kernel/events/emitter.ts';
import type { Logger } from '../../kernel/logging/logger.ts';
import { definePolicy, type PolicyDefinition } from '../policy/policy.ts';
import type { PolicyService } from '../policy/policy-service.ts';
import { validateSetting, type SettingDefinition } from './setting.ts';

/** The layer a setting value comes from, from lowest to highest precedence. */
export type SettingSource =
  'default' | 'policy-recommended' | 'user' | 'workspace' | 'policy-mandatory';

/** Where a value is written. */
export type SettingTarget =
  { readonly scope: 'user' } | { readonly scope: 'workspace'; readonly workspaceId: string };

/** Optional context for reading a value. */
export interface SettingContext {
  /** Applies the overrides of this workspace. */
  readonly workspaceId?: string;
}

/** The value of a setting with every layer that contributes to it. */
export interface SettingInspection<T> {
  readonly key: string;
  readonly value: T;
  readonly source: SettingSource;
  /** Whether a mandatory policy fixes the value. */
  readonly locked: boolean;
  readonly defaultValue: T;
  readonly recommendedValue?: T;
  readonly userValue?: T;
  readonly workspaceValue?: T;
  readonly mandatoryValue?: T;
}

/** Why a write was refused. */
export type SettingWriteError =
  | { readonly kind: 'invalid-value'; readonly message: string }
  | { readonly kind: 'locked-by-policy' }
  | { readonly kind: 'not-workspace-scoped' };

/** Sent after values changed. */
export interface SettingChange {
  readonly keys: readonly string[];
}

/** User and workspace values as stored on disk. */
export interface StoredSettings {
  readonly user: Readonly<Record<string, unknown>>;
  readonly workspaces: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
}

/** A stored value that failed validation. It is kept aside, never silently deleted. */
export interface RejectedSetting {
  readonly key: string;
  readonly value: unknown;
  readonly workspaceId?: string;
  readonly message: string;
}

/** Persists settings. The platform adapter writes atomically and debounces. */
export interface SettingsStore {
  load(): Promise<StoredSettings>;
  save(settings: StoredSettings, rejected: readonly RejectedSetting[]): Promise<void>;
}

/** Result of importing a settings file. */
export interface SettingsImportReport {
  readonly applied: readonly string[];
  readonly rejected: readonly RejectedSetting[];
  readonly locked: readonly string[];
}

/** Token for the {@link SettingsService}. */
export const SettingsServiceToken: Token<SettingsService> =
  token<SettingsService>('SettingsService');

/**
 * Derives the policy definitions of all settings that declare a policy, so that every
 * such setting can be set and locked by administrators.
 * @param definitions - All settings.
 */
export function settingPolicies(
  definitions: readonly SettingDefinition<unknown>[],
): PolicyDefinition<unknown>[] {
  return definitions.flatMap((d) =>
    d.policy === undefined
      ? []
      : [
          definePolicy({
            name: d.policy.name,
            schema: d.schema,
            setting: d.key,
            recommended: d.policy.recommended ?? false,
            sensitive: d.policy.sensitive ?? false,
            restartRequired: d.restartRequired ?? false,
          }),
        ],
  );
}

/**
 * Resolves setting values from defaults, policies, user and workspace values, validates
 * every write and keeps invalid stored values aside.
 *
 * Resolution order, lowest first: default, recommended policy, user, workspace override,
 * mandatory policy.
 */
export class SettingsService implements Disposable {
  private readonly definitions = new Map<string, SettingDefinition<unknown>>();
  private user = new Map<string, unknown>();
  private readonly workspaces = new Map<string, Map<string, unknown>>();
  /** Values of keys this version does not know; written back unchanged. */
  private unknownUser: Record<string, unknown> = {};
  private unknownWorkspaces: Record<string, Record<string, unknown>> = {};
  private rejectedList: RejectedSetting[] = [];
  private readonly changeEmitter = new Emitter<SettingChange>();
  private readonly policyListener: Disposable;
  private readonly policies: PolicyService;
  private readonly store: SettingsStore;
  private readonly logger: Logger;

  /** Fires after values changed through a write, an import or a policy change. */
  readonly onDidChange: Event<SettingChange> = this.changeEmitter.event;

  /**
   * @param definitions - Every setting, including those of inactive modules.
   * @param policies - Provides recommended and mandatory values.
   * @param store - Persists user and workspace values.
   * @param logger - Receives persistence errors.
   */
  constructor(
    definitions: readonly SettingDefinition<unknown>[],
    policies: PolicyService,
    store: SettingsStore,
    logger: Logger,
  ) {
    for (const definition of definitions) {
      this.definitions.set(definition.key, definition);
    }
    this.policies = policies;
    this.store = store;
    this.logger = logger.child('settings');
    this.policyListener = policies.onDidChange((names) => {
      const keys = names.flatMap((name) => {
        const setting = [...this.definitions.values()].find((d) => d.policy?.name === name);
        return setting === undefined ? [] : [setting.key];
      });
      if (keys.length > 0) {
        this.changeEmitter.fire({ keys });
      }
    });
  }

  /** Loads stored values. Invalid values are kept aside and reported by {@link SettingsService.rejected}. */
  async load(): Promise<void> {
    const stored = await this.store.load();
    const rejected: RejectedSetting[] = [];
    const split = (
      values: Readonly<Record<string, unknown>>,
      workspaceId?: string,
    ): [Map<string, unknown>, Record<string, unknown>] => {
      const known = new Map<string, unknown>();
      const unknown: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(values)) {
        const definition = this.definitions.get(key);
        if (definition === undefined) {
          unknown[key] = value;
          continue;
        }
        const checked = validateSetting(definition, value);
        if (!checked.ok) {
          rejected.push({
            key,
            value,
            message: checked.error,
            ...(workspaceId === undefined ? {} : { workspaceId }),
          });
        } else if (workspaceId !== undefined && definition.scope !== 'workspace') {
          rejected.push({ key, value, workspaceId, message: 'Setting is not workspace-scoped' });
        } else {
          known.set(key, checked.value);
        }
      }
      return [known, unknown];
    };
    [this.user, this.unknownUser] = split(stored.user);
    this.workspaces.clear();
    this.unknownWorkspaces = {};
    for (const [id, values] of Object.entries(stored.workspaces)) {
      const [known, unknown] = split(values, id);
      this.workspaces.set(id, known);
      if (Object.keys(unknown).length > 0) {
        this.unknownWorkspaces[id] = unknown;
      }
    }
    this.rejectedList = rejected;
    if (rejected.length > 0) {
      this.logger.warn('Invalid stored settings were set aside', { count: rejected.length });
      this.persist();
    }
  }

  /**
   * Returns the effective value of a setting.
   * @param definition - The setting.
   * @param context - Workspace to apply overrides for.
   */
  get<T>(definition: SettingDefinition<T>, context: SettingContext = {}): T {
    return this.inspect(definition, context).value;
  }

  /**
   * Returns the effective value and every contributing layer.
   * @param definition - The setting.
   * @param context - Workspace to apply overrides for.
   */
  inspect<T>(definition: SettingDefinition<T>, context: SettingContext = {}): SettingInspection<T> {
    const { key } = definition;
    const policyName = definition.policy?.name;
    const mandatory = policyName === undefined ? undefined : this.policies.getMandatory(policyName);
    const recommended =
      policyName === undefined ? undefined : this.policies.getRecommended(policyName);
    const workspace =
      context.workspaceId === undefined ? undefined : this.workspaces.get(context.workspaceId);
    const result: Mutable<SettingInspection<T>> = {
      key,
      value: definition.default,
      source: 'default',
      locked: mandatory !== undefined,
      defaultValue: definition.default,
    };
    // Layers in ascending precedence; each present layer overrides the previous one.
    if (recommended !== undefined) {
      result.value = result.recommendedValue = settingValue(definition, recommended.value);
      result.source = 'policy-recommended';
    }
    if (this.user.has(key)) {
      result.value = result.userValue = settingValue(definition, this.user.get(key));
      result.source = 'user';
    }
    if (workspace?.has(key) === true) {
      result.value = result.workspaceValue = settingValue(definition, workspace.get(key));
      result.source = 'workspace';
    }
    if (mandatory !== undefined) {
      result.value = result.mandatoryValue = settingValue(definition, mandatory.value);
      result.source = 'policy-mandatory';
    }
    return result;
  }

  /**
   * Writes a value after validating it.
   * @param definition - The setting.
   * @param value - The new value.
   * @param target - User value or workspace override.
   */
  set<T>(
    definition: SettingDefinition<T>,
    value: unknown,
    target: SettingTarget = { scope: 'user' },
  ): Result<void, SettingWriteError> {
    if (this.policies.isLocked(definition.key)) {
      return err({ kind: 'locked-by-policy' });
    }
    if (target.scope === 'workspace' && definition.scope !== 'workspace') {
      return err({ kind: 'not-workspace-scoped' });
    }
    const checked = validateSetting(definition, value);
    if (!checked.ok) {
      return err({ kind: 'invalid-value', message: checked.error });
    }
    this.layerFor(target, true)?.set(definition.key, checked.value);
    this.changed([definition.key]);
    return ok(undefined);
  }

  /**
   * Removes a user value or workspace override, so the next layer applies again.
   * @param definition - The setting.
   * @param target - Which value to remove.
   */
  reset(definition: SettingDefinition<unknown>, target: SettingTarget = { scope: 'user' }): void {
    if (this.layerFor(target, false)?.delete(definition.key) === true) {
      this.changed([definition.key]);
    }
  }

  /** User values that differ from the defaults, sorted by key, for export. Never contains secrets. */
  exportUserSettings(): Record<string, unknown> {
    return Object.fromEntries([...this.user].toSorted(([a], [b]) => a.localeCompare(b)));
  }

  /**
   * Imports user values from an exported object. Unknown keys are ignored, invalid values
   * are reported, locked settings are skipped.
   * @param data - Parsed JSON object.
   */
  importUserSettings(data: unknown): Result<SettingsImportReport, string> {
    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
      return err('Expected an object of setting values');
    }
    const applied: string[] = [];
    const rejected: RejectedSetting[] = [];
    const locked: string[] = [];
    for (const [key, value] of Object.entries(data)) {
      const definition = this.definitions.get(key);
      if (definition === undefined) {
        continue;
      }
      if (this.policies.isLocked(key)) {
        locked.push(key);
        continue;
      }
      const checked = validateSetting(definition, value);
      if (checked.ok) {
        this.user.set(key, checked.value);
        applied.push(key);
      } else {
        rejected.push({ key, value, message: checked.error });
      }
    }
    if (applied.length > 0) {
      this.changed(applied);
    }
    return ok({ applied, rejected, locked });
  }

  /** Stored values that failed validation at load time. */
  rejected(): readonly RejectedSetting[] {
    return this.rejectedList;
  }

  /** Removes all listeners. */
  dispose(): void {
    this.policyListener.dispose();
    this.changeEmitter.dispose();
  }

  private layerFor(target: SettingTarget, create: boolean): Map<string, unknown> | undefined {
    if (target.scope === 'user') {
      return this.user;
    }
    let layer = this.workspaces.get(target.workspaceId);
    if (layer === undefined && create) {
      layer = new Map();
      this.workspaces.set(target.workspaceId, layer);
    }
    return layer;
  }

  private changed(keys: readonly string[]): void {
    this.changeEmitter.fire({ keys });
    this.persist();
  }

  private persist(): void {
    const workspaces: Record<string, Record<string, unknown>> = { ...this.unknownWorkspaces };
    for (const [id, values] of this.workspaces) {
      workspaces[id] = { ...workspaces[id], ...Object.fromEntries(values) };
    }
    const settings: StoredSettings = {
      user: { ...this.unknownUser, ...Object.fromEntries(this.user) },
      workspaces,
    };
    this.store.save(settings, this.rejectedList).catch((error: unknown) => {
      this.logger.error('Saving settings failed', error);
    });
  }
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/**
 * Narrows a stored value to the type of `_definition`. Every value in the layers was validated
 * against the setting's schema when it was written, loaded or read from policy.
 */
function settingValue<T>(_definition: SettingDefinition<T>, value: unknown): T {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- validated on write
  return value as T;
}
