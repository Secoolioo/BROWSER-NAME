import * as v from 'valibot';
import { err, ok, type Result } from '../../shared/result.ts';

/** Where a setting can be overridden: globally only, or also per workspace. */
export type SettingScope = 'global' | 'workspace';

/** Links a setting to the policy that administrators use to set or lock it. */
export interface SettingPolicy {
  /** Policy name in PascalCase, such as `TabStripPosition`. Never renamed once released. */
  readonly name: string;
  /** Whether the policy may also be set as a recommended (user-changeable) default. */
  readonly recommended?: boolean;
  /**
   * Sensitive policies (update source, proxy, search engine) are only accepted from
   * machine-wide, mandatory sources.
   */
  readonly sensitive?: boolean;
}

/** How the settings page presents a setting. Texts come from the module's locale catalog. */
export interface SettingUi {
  /** Section id on the settings page, such as `appearance`. */
  readonly section: string;
  /** Control used to edit the value. */
  readonly control: 'toggle' | 'select' | 'text' | 'number' | 'color' | 'list' | 'shortcut';
  /** Sort order inside the section; lower comes first. */
  readonly order?: number;
}

/**
 * Declares one setting. It is the single source for the settings page, the policy
 * templates, the JSON schema and the documentation.
 */
export interface SettingDefinition<T> {
  /** Dotted key, such as `tabs.position`. Never renamed without a migration. */
  readonly key: string;
  /** Valibot schema that every value must satisfy. */
  readonly schema: v.GenericSchema<unknown, T>;
  /** Value used when nothing else is set. */
  readonly default: T;
  readonly scope: SettingScope;
  readonly policy?: SettingPolicy;
  readonly ui?: SettingUi;
  /** Whether a change only takes effect after a restart. */
  readonly restartRequired?: boolean;
}

/** Thrown for an invalid setting definition. */
export class SettingDefinitionError extends Error {
  override readonly name = 'SettingDefinitionError';
}

const keyPattern = /^[a-z][a-zA-Z0-9]*(?:\.[a-z][a-zA-Z0-9]*)+$/;
const policyPattern = /^[A-Z][A-Za-z0-9]*$/;

/**
 * Declares a setting and checks that its key, policy name and default are valid.
 * @param definition - The setting.
 * @returns The frozen definition, which also serves as a typed handle for
 *   `settings.get(definition)`.
 * @throws SettingDefinitionError for an invalid key, policy name or default.
 */
export function defineSetting<T>(definition: SettingDefinition<T>): SettingDefinition<T> {
  if (!keyPattern.test(definition.key)) {
    throw new SettingDefinitionError(
      `Setting key "${definition.key}" must be dotted camelCase, such as "tabs.position"`,
    );
  }
  if (definition.policy !== undefined && !policyPattern.test(definition.policy.name)) {
    throw new SettingDefinitionError(
      `Policy name "${definition.policy.name}" of ${definition.key} must be PascalCase`,
    );
  }
  const parsed = v.safeParse(definition.schema, definition.default);
  if (!parsed.success) {
    throw new SettingDefinitionError(
      `Default of ${definition.key} does not match its schema: ${parsed.issues[0].message}`,
    );
  }
  return Object.freeze(definition);
}

/**
 * Validates a value against a setting's schema.
 * @param definition - The setting.
 * @param value - Any value, for example from a file or a policy.
 * @returns The parsed value, or the first validation message as the error.
 */
export function validateSetting<T>(
  definition: SettingDefinition<T>,
  value: unknown,
): Result<T, string> {
  const parsed = v.safeParse(definition.schema, value);
  return parsed.success ? ok(parsed.output) : err(parsed.issues[0].message);
}
