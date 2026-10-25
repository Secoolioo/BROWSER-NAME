import * as v from 'valibot';
import { definePolicy, type PolicyDefinition } from '../policy/policy.ts';
import { UpdateChannelSchema } from './feed.ts';
import type { UpdateMode } from './update-service.ts';

/** `UpdatePolicy`: 0 turns updates off, 1 updates automatically, 2 only on request. */
export const UpdatePolicy = definePolicy({
  name: 'UpdatePolicy',
  schema: v.picklist([0, 1, 2]),
});

/** `TargetChannel`: the update channel, `stable` or `beta`. */
export const TargetChannel = definePolicy({
  name: 'TargetChannel',
  schema: UpdateChannelSchema,
});

/** `TargetVersionPrefix`: only versions with this prefix are installed, such as `0.1`. */
export const TargetVersionPrefix = definePolicy({
  name: 'TargetVersionPrefix',
  schema: v.pipe(v.string(), v.regex(/^\d+(\.\d+){0,2}\.?$/, 'Must be a version prefix')),
});

/**
 * `UpdateURL`: the root of an organization mirror of the feed. Sensitive, because it
 * decides where updates come from; the signatures are checked all the same.
 */
export const UpdateURL = definePolicy({
  name: 'UpdateURL',
  schema: v.pipe(v.string(), v.url(), v.regex(/^https?:\/\//i, 'Must be an http or https URL')),
  sensitive: true,
});

/** `AutoUpdateCheckPeriodMinutes`: minutes between automatic checks, 60 to 43200. */
export const AutoUpdateCheckPeriodMinutes = definePolicy({
  name: 'AutoUpdateCheckPeriodMinutes',
  schema: v.pipe(v.number(), v.integer(), v.minValue(60), v.maxValue(43_200)),
});

/** All update policies. */
export const updatePolicies: readonly PolicyDefinition<unknown>[] = [
  UpdatePolicy,
  TargetChannel,
  TargetVersionPrefix,
  UpdateURL,
  AutoUpdateCheckPeriodMinutes,
];

/** Default minutes between automatic checks. */
export const defaultCheckPeriodMinutes = 240;

/**
 * Maps the `UpdatePolicy` value to a mode; without a policy, updates are automatic.
 * @param value - The policy value.
 */
export function updateMode(value: 0 | 1 | 2 | undefined): UpdateMode {
  if (value === 0) return 'off';
  if (value === 2) return 'manual';
  return 'automatic';
}
