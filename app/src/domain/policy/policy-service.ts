import * as v from 'valibot';
import type { Disposable } from '../../shared/disposable.ts';
import { token, type Token } from '../../kernel/di/token.ts';
import { Emitter, type Event } from '../../kernel/events/emitter.ts';
import type { Logger } from '../../kernel/logging/logger.ts';
import type {
  PolicyDefinition,
  PolicyLevel,
  PolicyProvider,
  PolicyReadError,
  PolicyScope,
  RawPolicyValue,
} from './policy.ts';

/** Outcome for one policy value, as listed on the diagnostics page. */
export type PolicyState =
  | 'applied'
  | 'overridden'
  | 'invalid'
  | 'unknown'
  | 'not-allowed-as-recommended'
  | 'sensitive-requires-machine';

/** One policy value with the reason it was or was not applied. */
export interface PolicyStatus {
  readonly name: string;
  readonly value: unknown;
  readonly level: PolicyLevel;
  readonly scope: PolicyScope;
  readonly source: string;
  readonly state: PolicyState;
  /** Explanation for states other than `applied`. */
  readonly message?: string;
}

/** An applied policy value. */
export interface EffectivePolicy {
  readonly value: unknown;
  readonly scope: PolicyScope;
  readonly source: string;
}

/** Stores the last known raw values, used when a provider cannot be read at startup. */
export interface PolicyCache {
  read(): readonly RawPolicyValue[] | undefined;
  write(values: readonly RawPolicyValue[]): void;
}

/** Token for the {@link PolicyService}. */
export const PolicyServiceToken: Token<PolicyService> = token<PolicyService>('PolicyService');

/**
 * Merges the values of all policy providers, validates them against the policy
 * definitions and answers which value applies and whether a setting is locked.
 *
 * Precedence: mandatory before recommended, and within a level machine before user.
 * Sensitive policies are only applied from machine-wide mandatory sources. Invalid values
 * are ignored and reported, never guessed.
 */
export class PolicyService implements Disposable {
  private readonly definitions = new Map<string, PolicyDefinition<unknown>>();
  private readonly bySetting = new Map<string, PolicyDefinition<unknown>>();
  private readonly providers: readonly PolicyProvider[];
  private readonly cache: PolicyCache | undefined;
  private readonly logger: Logger;
  private readonly changeEmitter = new Emitter<readonly string[]>();
  private mandatory = new Map<string, EffectivePolicy>();
  private recommended = new Map<string, EffectivePolicy>();
  private statusList: readonly PolicyStatus[] = [];
  private errorList: readonly PolicyReadError[] = [];

  /** Fires with the names of policies whose effective value changed. */
  readonly onDidChange: Event<readonly string[]> = this.changeEmitter.event;

  /**
   * @param definitions - All known policies, including setting policies.
   * @param providers - Sources for the current platform.
   * @param logger - Receives read problems.
   * @param cache - Optional fallback for providers that fail at startup.
   */
  constructor(
    definitions: readonly PolicyDefinition<unknown>[],
    providers: readonly PolicyProvider[],
    logger: Logger,
    cache?: PolicyCache,
  ) {
    for (const definition of definitions) {
      this.definitions.set(definition.name, definition);
      if (definition.setting !== undefined) {
        this.bySetting.set(definition.setting, definition);
      }
    }
    this.providers = providers;
    this.logger = logger.child('policy');
    this.cache = cache;
  }

  /**
   * Reads all providers synchronously and applies the result. Called once before the
   * browser is ready, then on window focus and periodically.
   * @returns The names of policies whose effective value changed.
   */
  refresh(): readonly string[] {
    const values: RawPolicyValue[] = [];
    const errors: PolicyReadError[] = [];
    for (const provider of this.providers) {
      const result = provider.load();
      values.push(...result.values);
      errors.push(...result.errors);
    }
    let raw: readonly RawPolicyValue[] = values;
    if (errors.length > 0 && values.length === 0 && this.cache !== undefined) {
      raw = this.cache.read() ?? values;
    } else {
      this.cache?.write(values);
    }
    for (const error of errors) {
      this.logger.warn('Policy source could not be read', { ...error });
    }
    this.errorList = errors;
    return this.apply(raw);
  }

  /**
   * The value that a mandatory policy forces, if any.
   * @param name - Policy name.
   */
  getMandatory(name: string): EffectivePolicy | undefined {
    return this.mandatory.get(name);
  }

  /**
   * The value that a mandatory policy forces, typed by its definition.
   * @param definition - The policy, as registered with this service.
   */
  mandatoryValue<T>(definition: PolicyDefinition<T>): T | undefined {
    if (this.definitions.get(definition.name) !== definition) {
      throw new Error(`Policy ${definition.name} is not registered`);
    }
    const value = this.mandatory.get(definition.name)?.value;
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- validated against this definition when read
    return value as T | undefined;
  }

  /**
   * The recommended default from policy, if any.
   * @param name - Policy name.
   */
  getRecommended(name: string): EffectivePolicy | undefined {
    return this.recommended.get(name);
  }

  /**
   * The policy that belongs to a setting.
   * @param settingKey - A setting key.
   */
  definitionForSetting(settingKey: string): PolicyDefinition<unknown> | undefined {
    return this.bySetting.get(settingKey);
  }

  /**
   * Tells whether a mandatory policy locks a setting.
   * @param settingKey - A setting key.
   */
  isLocked(settingKey: string): boolean {
    const definition = this.bySetting.get(settingKey);
    return definition !== undefined && this.mandatory.has(definition.name);
  }

  /** Every value read in the last refresh, with its state. */
  statuses(): readonly PolicyStatus[] {
    return this.statusList;
  }

  /** Problems from the last refresh. */
  readErrors(): readonly PolicyReadError[] {
    return this.errorList;
  }

  /** Removes all listeners. */
  dispose(): void {
    this.changeEmitter.dispose();
  }

  private apply(raw: readonly RawPolicyValue[]): readonly string[] {
    const statuses: PolicyStatus[] = [];
    const mandatory = new Map<string, EffectivePolicy>();
    const recommended = new Map<string, EffectivePolicy>();
    for (const item of raw.toSorted((a, b) => rank(a) - rank(b))) {
      const definition = this.definitions.get(item.name);
      const reject = (state: PolicyState, message: string): void => {
        statuses.push({ ...item, state, message });
      };
      if (definition === undefined) {
        reject('unknown', 'This browser version does not know this policy');
        continue;
      }
      if (item.level === 'recommended' && definition.recommended !== true) {
        reject('not-allowed-as-recommended', 'This policy can only be set as mandatory');
        continue;
      }
      if (
        definition.sensitive === true &&
        (item.scope !== 'machine' || item.level !== 'mandatory')
      ) {
        reject('sensitive-requires-machine', 'Only machine-wide mandatory policies may set this');
        continue;
      }
      let parsed = v.safeParse(definition.schema, item.value);
      if (!parsed.success && (item.value === 0 || item.value === 1)) {
        // The Windows registry stores booleans as DWORD 0 or 1.
        const asBoolean = v.safeParse(definition.schema, item.value === 1);
        if (asBoolean.success) {
          parsed = asBoolean;
        }
      }
      if (!parsed.success) {
        reject('invalid', parsed.issues[0].message);
        continue;
      }
      const target = item.level === 'mandatory' ? mandatory : recommended;
      if (target.has(item.name)) {
        reject('overridden', 'A value with higher precedence applies');
        continue;
      }
      target.set(item.name, { value: parsed.output, scope: item.scope, source: item.source });
      statuses.push({ ...item, value: parsed.output, state: 'applied' });
    }
    const before = this.snapshot();
    this.mandatory = mandatory;
    this.recommended = recommended;
    this.statusList = statuses;
    const after = this.snapshot();
    const changed = [...new Set([...before.keys(), ...after.keys()])].filter(
      (name) => before.get(name) !== after.get(name),
    );
    if (changed.length > 0) {
      this.changeEmitter.fire(changed);
    }
    return changed;
  }

  /** Serialized effective values per policy name, for change detection. */
  private snapshot(): Map<string, string> {
    const names = new Set([...this.mandatory.keys(), ...this.recommended.keys()]);
    return new Map(
      [...names].map((name) => [
        name,
        JSON.stringify([this.mandatory.get(name)?.value, this.recommended.get(name)?.value]),
      ]),
    );
  }
}

/** Sort key for precedence: mandatory before recommended, machine before user. */
function rank(value: RawPolicyValue): number {
  return (value.level === 'mandatory' ? 0 : 2) + (value.scope === 'machine' ? 0 : 1);
}
