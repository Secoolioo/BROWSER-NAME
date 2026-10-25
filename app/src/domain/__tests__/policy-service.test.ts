import * as v from 'valibot';
import { describe, expect, it, vi } from 'vitest';
import { RingBufferLogSink, SinkLogger } from '../../kernel/logging/logger.ts';
import { ManualClock } from '../../kernel/time/clock.ts';
import {
  PolicyDefinitionError,
  definePolicy,
  type PolicyProvider,
  type PolicyReadResult,
  type RawPolicyValue,
} from '../policy/policy.ts';
import { PolicyService, type PolicyCache } from '../policy/policy-service.ts';

const UpdatePolicy = definePolicy({ name: 'UpdatePolicy', schema: v.picklist([0, 1, 2]) });
const Homepage = definePolicy({
  name: 'HomepageLocation',
  schema: v.pipe(v.string(), v.url()),
  recommended: true,
  setting: 'startup.homepage',
});
const UpdateUrl = definePolicy({ name: 'UpdateURL', schema: v.string(), sensitive: true });

/** Provider whose result tests can change between refreshes. */
class FakeProvider implements PolicyProvider {
  readonly name = 'fake';
  result: PolicyReadResult = { values: [], errors: [] };
  load(): PolicyReadResult {
    return this.result;
  }
}

const value = (
  name: string,
  val: unknown,
  level: RawPolicyValue['level'] = 'mandatory',
  scope: RawPolicyValue['scope'] = 'machine',
): RawPolicyValue => ({ name, value: val, level, scope, source: `${scope}:${level}` });

function service(cache?: PolicyCache): {
  policies: PolicyService;
  provider: FakeProvider;
  sink: RingBufferLogSink;
} {
  const provider = new FakeProvider();
  const sink = new RingBufferLogSink();
  const logger = new SinkLogger(sink, new ManualClock(), { scope: 'test' });
  return {
    policies: new PolicyService([UpdatePolicy, Homepage, UpdateUrl], [provider], logger, cache),
    provider,
    sink,
  };
}

describe('definePolicy', () => {
  it('requires PascalCase names', () => {
    expect(() => definePolicy({ name: 'updatePolicy', schema: v.number() })).toThrow(
      PolicyDefinitionError,
    );
  });
});

describe('PolicyService', () => {
  it('applies valid mandatory and recommended values and locks settings', () => {
    const { policies, provider } = service();
    provider.result = {
      values: [
        value('UpdatePolicy', 2),
        value('HomepageLocation', 'https://intranet.example/', 'recommended'),
      ],
      errors: [],
    };
    expect(policies.refresh()).toEqual(['UpdatePolicy', 'HomepageLocation']);
    expect(policies.getMandatory('UpdatePolicy')?.value).toBe(2);
    expect(policies.getRecommended('HomepageLocation')?.value).toBe('https://intranet.example/');
    expect(policies.isLocked('startup.homepage')).toBe(false);
    expect(policies.definitionForSetting('startup.homepage')).toBe(Homepage);
  });

  it('prefers mandatory over recommended and machine over user', () => {
    const { policies, provider } = service();
    provider.result = {
      values: [
        value('HomepageLocation', 'https://user.example/', 'mandatory', 'user'),
        value('HomepageLocation', 'https://machine.example/', 'mandatory', 'machine'),
        value('HomepageLocation', 'https://recommended.example/', 'recommended', 'machine'),
      ],
      errors: [],
    };
    policies.refresh();
    expect(policies.getMandatory('HomepageLocation')?.value).toBe('https://machine.example/');
    expect(policies.isLocked('startup.homepage')).toBe(true);
    expect(policies.statuses().map((s) => s.state)).toEqual(['applied', 'overridden', 'applied']);
  });

  it('reports unknown, invalid, wrong-level and non-machine sensitive values', () => {
    const { policies, provider } = service();
    provider.result = {
      values: [
        value('NoSuchPolicy', true),
        value('UpdatePolicy', 7),
        value('UpdatePolicy', 1, 'recommended'),
        value('UpdateURL', 'https://mirror.example/', 'mandatory', 'user'),
      ],
      errors: [],
    };
    policies.refresh();
    expect(policies.statuses().map((s) => [s.name, s.state])).toEqual([
      ['NoSuchPolicy', 'unknown'],
      ['UpdatePolicy', 'invalid'],
      ['UpdateURL', 'sensitive-requires-machine'],
      ['UpdatePolicy', 'not-allowed-as-recommended'],
    ]);
    expect(policies.getMandatory('UpdatePolicy')).toBeUndefined();
    expect(policies.getMandatory('UpdateURL')).toBeUndefined();
  });

  it('accepts registry DWORD 0 and 1 for boolean policies', () => {
    const Flag = definePolicy({ name: 'DeveloperToolsAvailability', schema: v.boolean() });
    const provider = new FakeProvider();
    const logger = new SinkLogger(new RingBufferLogSink(), new ManualClock(), { scope: 't' });
    const policies = new PolicyService([Flag], [provider], logger);
    provider.result = { values: [value('DeveloperToolsAvailability', 0)], errors: [] };
    policies.refresh();
    expect(policies.getMandatory('DeveloperToolsAvailability')?.value).toBe(false);
    provider.result = { values: [value('DeveloperToolsAvailability', 3)], errors: [] };
    policies.refresh();
    expect(policies.statuses()[0]?.state).toBe('invalid');
  });

  it('notifies only about changed policies', () => {
    const { policies, provider } = service();
    const listener = vi.fn();
    policies.onDidChange(listener);
    provider.result = { values: [value('UpdatePolicy', 1)], errors: [] };
    policies.refresh();
    expect(policies.refresh()).toEqual([]);
    provider.result = { values: [], errors: [] };
    expect(policies.refresh()).toEqual(['UpdatePolicy']);
    expect(listener.mock.calls).toEqual([[['UpdatePolicy']], [['UpdatePolicy']]]);
  });

  it('falls back to the cache when sources fail and logs read errors', () => {
    const stored: RawPolicyValue[] = [value('UpdatePolicy', 0)];
    const write = vi.fn();
    const cache: PolicyCache = { read: () => stored, write };
    const { policies, provider, sink } = service(cache);
    provider.result = { values: [], errors: [{ source: 'registry', message: 'denied' }] };
    policies.refresh();
    expect(policies.getMandatory('UpdatePolicy')?.value).toBe(0);
    expect(policies.readErrors()).toEqual([{ source: 'registry', message: 'denied' }]);
    expect(sink.records.map((r) => r.message)).toContain('Policy source could not be read');
    provider.result = { values: [value('UpdatePolicy', 2)], errors: [] };
    policies.refresh();
    expect(write).toHaveBeenCalledWith([value('UpdatePolicy', 2)]);
    policies.dispose();
  });
});
