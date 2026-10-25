import type * as v from 'valibot';
import { token, type Token } from '../../kernel/di/token.ts';

/** Whether a policy forces a value or only suggests a default that users may change. */
export type PolicyLevel = 'mandatory' | 'recommended';

/** Whether a policy was set for the whole machine or for the current user. */
export type PolicyScope = 'machine' | 'user';

/** Declares a policy that administrators can set. */
export interface PolicyDefinition<T> {
  /** Name in PascalCase, such as `UpdatePolicy`. Never renamed once released. */
  readonly name: string;
  /** Valibot schema for the value. */
  readonly schema: v.GenericSchema<unknown, T>;
  /** Setting key this policy sets or locks, if it is a setting policy. */
  readonly setting?: string;
  /** Whether the policy may be set as recommended. Standalone policies are mandatory only. */
  readonly recommended?: boolean;
  /** Sensitive policies are only accepted from machine-wide mandatory sources. */
  readonly sensitive?: boolean;
  /** Whether a change only takes effect after a restart. */
  readonly restartRequired?: boolean;
}

/** A value as read by a provider, before validation. */
export interface RawPolicyValue {
  readonly name: string;
  readonly value: unknown;
  readonly level: PolicyLevel;
  readonly scope: PolicyScope;
  /** Where the value came from, for the diagnostics page, such as `HKLM\SOFTWARE\Policies`. */
  readonly source: string;
}

/** A problem a provider ran into, such as an unreadable file. */
export interface PolicyReadError {
  readonly source: string;
  readonly message: string;
}

/** Everything a provider read in one pass. */
export interface PolicyReadResult {
  readonly values: readonly RawPolicyValue[];
  readonly errors: readonly PolicyReadError[];
}

/**
 * Reads policies from one platform source. `load` is synchronous on purpose: policies
 * are read before the browser is ready, because some of them become command line
 * switches that Chromium only reads at startup.
 */
export interface PolicyProvider {
  /** Name for diagnostics, such as `windows-registry`. */
  readonly name: string;
  /** Reads all policy values. Must not throw; problems are returned as errors. */
  load(): PolicyReadResult;
}

/** Token for the list of {@link PolicyProvider}s of the current platform. */
export const PolicyProvidersToken: Token<readonly PolicyProvider[]> =
  token<readonly PolicyProvider[]>('PolicyProviders');

/** Thrown for an invalid policy definition. */
export class PolicyDefinitionError extends Error {
  override readonly name = 'PolicyDefinitionError';
}

/**
 * Declares a policy.
 * @param definition - The policy.
 * @returns The frozen definition.
 * @throws PolicyDefinitionError when the name is not PascalCase.
 */
export function definePolicy<T>(definition: PolicyDefinition<T>): PolicyDefinition<T> {
  if (!/^[A-Z][A-Za-z0-9]*$/.test(definition.name)) {
    throw new PolicyDefinitionError(`Policy name "${definition.name}" must be PascalCase`);
  }
  return Object.freeze(definition);
}
