import * as v from 'valibot';
import { describe, expect, it, vi } from 'vitest';
import { RingBufferLogSink, SinkLogger } from '../../kernel/logging/logger.ts';
import { ManualClock } from '../../kernel/time/clock.ts';
import type { PolicyProvider, PolicyReadResult } from '../policy/policy.ts';
import { PolicyService } from '../policy/policy-service.ts';
import { SettingDefinitionError, defineSetting } from '../settings/setting.ts';
import {
  SettingsService,
  settingPolicies,
  type RejectedSetting,
  type SettingsStore,
  type StoredSettings,
} from '../settings/settings-service.ts';

const TabPosition = defineSetting({
  key: 'tabs.position',
  schema: v.picklist(['top', 'bottom', 'left', 'right']),
  default: 'top',
  scope: 'workspace',
  policy: { name: 'TabStripPosition', recommended: true },
  ui: { section: 'tabs', control: 'select' },
});
const Density = defineSetting({
  key: 'appearance.density',
  schema: v.picklist(['compact', 'normal', 'comfortable']),
  default: 'normal',
  scope: 'global',
});
const definitions = [TabPosition, Density];

class MemoryStore implements SettingsStore {
  stored: StoredSettings = { user: {}, workspaces: {} };
  readonly save = vi.fn((settings: StoredSettings, rejected: readonly RejectedSetting[]) => {
    this.saved = { settings, rejected };
    return Promise.resolve();
  });
  saved: { settings: StoredSettings; rejected: readonly RejectedSetting[] } | undefined;
  load(): Promise<StoredSettings> {
    return Promise.resolve(this.stored);
  }
}

class FakeProvider implements PolicyProvider {
  readonly name = 'fake';
  result: PolicyReadResult = { values: [], errors: [] };
  load(): PolicyReadResult {
    return this.result;
  }
}

function setup(): {
  settings: SettingsService;
  store: MemoryStore;
  provider: FakeProvider;
  policies: PolicyService;
  sink: RingBufferLogSink;
} {
  const sink = new RingBufferLogSink();
  const logger = new SinkLogger(sink, new ManualClock(), { scope: 'test' });
  const provider = new FakeProvider();
  const policies = new PolicyService(settingPolicies(definitions), [provider], logger);
  const store = new MemoryStore();
  return {
    settings: new SettingsService(definitions, policies, store, logger),
    store,
    provider,
    policies,
    sink,
  };
}

describe('defineSetting', () => {
  it('validates the key, the policy name and the default', () => {
    const base = { schema: v.boolean(), default: true, scope: 'global' as const };
    expect(() => defineSetting({ ...base, key: 'Tabs' })).toThrow(SettingDefinitionError);
    expect(() =>
      defineSetting({ ...base, key: 'tabs.sleep', policy: { name: 'tab_sleep' } }),
    ).toThrow(/PascalCase/);
    expect(() =>
      defineSetting({
        key: 'tabs.limit',
        schema: v.pipe(v.number(), v.minValue(1)),
        default: 0,
        scope: 'global',
      }),
    ).toThrow(/does not match its schema/);
  });
});

describe('SettingsService', () => {
  it('resolves default, recommended, user, workspace and mandatory values in order', () => {
    const { settings, provider, policies } = setup();
    expect(settings.inspect(TabPosition)).toEqual({
      key: 'tabs.position',
      value: 'top',
      source: 'default',
      locked: false,
      defaultValue: 'top',
    });
    provider.result = {
      values: [
        {
          name: 'TabStripPosition',
          value: 'bottom',
          level: 'recommended',
          scope: 'machine',
          source: 'test',
        },
      ],
      errors: [],
    };
    policies.refresh();
    expect(settings.inspect(TabPosition).source).toBe('policy-recommended');
    expect(settings.set(TabPosition, 'left').ok).toBe(true);
    expect(settings.get(TabPosition)).toBe('left');
    expect(settings.set(TabPosition, 'right', { scope: 'workspace', workspaceId: 'w1' }).ok).toBe(
      true,
    );
    expect(settings.get(TabPosition, { workspaceId: 'w1' })).toBe('right');
    expect(settings.get(TabPosition, { workspaceId: 'w2' })).toBe('left');
    provider.result = {
      values: [
        {
          name: 'TabStripPosition',
          value: 'top',
          level: 'mandatory',
          scope: 'machine',
          source: 'test',
        },
      ],
      errors: [],
    };
    policies.refresh();
    expect(settings.inspect(TabPosition, { workspaceId: 'w1' })).toEqual({
      key: 'tabs.position',
      value: 'top',
      source: 'policy-mandatory',
      locked: true,
      defaultValue: 'top',
      userValue: 'left',
      workspaceValue: 'right',
      mandatoryValue: 'top',
    });
  });

  it('refuses invalid, locked and wrongly scoped writes', () => {
    const { settings, provider, policies } = setup();
    expect(settings.set(TabPosition, 'diagonal')).toEqual({
      ok: false,
      error: { kind: 'invalid-value', message: expect.any(String) },
    });
    expect(settings.set(Density, 'compact', { scope: 'workspace', workspaceId: 'w' })).toEqual({
      ok: false,
      error: { kind: 'not-workspace-scoped' },
    });
    provider.result = {
      values: [
        {
          name: 'TabStripPosition',
          value: 'top',
          level: 'mandatory',
          scope: 'machine',
          source: 'test',
        },
      ],
      errors: [],
    };
    policies.refresh();
    expect(settings.set(TabPosition, 'left')).toEqual({
      ok: false,
      error: { kind: 'locked-by-policy' },
    });
  });

  it('notifies on writes, resets and policy changes, and persists', () => {
    const { settings, store, provider, policies } = setup();
    const listener = vi.fn();
    settings.onDidChange(listener);
    settings.set(Density, 'compact');
    settings.reset(Density);
    settings.reset(Density);
    provider.result = {
      values: [
        {
          name: 'TabStripPosition',
          value: 'left',
          level: 'mandatory',
          scope: 'machine',
          source: 'test',
        },
      ],
      errors: [],
    };
    policies.refresh();
    expect(listener.mock.calls).toEqual([
      [{ keys: ['appearance.density'] }],
      [{ keys: ['appearance.density'] }],
      [{ keys: ['tabs.position'] }],
    ]);
    expect(store.save).toHaveBeenCalledTimes(2);
    expect(settings.get(Density)).toBe('normal');
  });

  it('loads stored values, keeps unknown keys and sets invalid values aside', async () => {
    const { settings, store } = setup();
    store.stored = {
      user: { 'tabs.position': 'bottom', 'appearance.density': 'huge', 'future.setting': 42 },
      workspaces: {
        w1: { 'tabs.position': 'right', 'appearance.density': 'compact', 'future.ws': 1 },
      },
    };
    await settings.load();
    expect(settings.get(TabPosition)).toBe('bottom');
    expect(settings.get(TabPosition, { workspaceId: 'w1' })).toBe('right');
    expect(settings.get(Density)).toBe('normal');
    expect(settings.rejected().map((r) => [r.key, r.workspaceId])).toEqual([
      ['appearance.density', undefined],
      ['appearance.density', 'w1'],
    ]);
    expect(store.saved?.settings).toEqual({
      user: { 'future.setting': 42, 'tabs.position': 'bottom' },
      workspaces: { w1: { 'future.ws': 1, 'tabs.position': 'right' } },
    });
    expect(store.saved?.rejected).toHaveLength(2);
  });

  it('exports and imports user values', () => {
    const { settings, provider, policies } = setup();
    settings.set(TabPosition, 'right');
    settings.set(Density, 'compact');
    const exported = settings.exportUserSettings();
    expect(Object.keys(exported)).toEqual(['appearance.density', 'tabs.position']);
    provider.result = {
      values: [
        {
          name: 'TabStripPosition',
          value: 'top',
          level: 'mandatory',
          scope: 'machine',
          source: 'test',
        },
      ],
      errors: [],
    };
    policies.refresh();
    const fresh = setup();
    fresh.provider.result = provider.result;
    fresh.policies.refresh();
    const report = fresh.settings.importUserSettings({
      ...exported,
      'appearance.density': 'huge',
      unknown: 1,
    });
    expect(report).toEqual({
      ok: true,
      value: {
        applied: [],
        rejected: [{ key: 'appearance.density', value: 'huge', message: expect.any(String) }],
        locked: ['tabs.position'],
      },
    });
    expect(setup().settings.importUserSettings(exported)).toMatchObject({
      ok: true,
      value: { applied: ['appearance.density', 'tabs.position'] },
    });
    expect(fresh.settings.importUserSettings([1])).toEqual({
      ok: false,
      error: expect.any(String),
    });
  });

  it('logs failed saves', async () => {
    const { settings, store, sink } = setup();
    store.save.mockRejectedValueOnce(new Error('disk full'));
    settings.set(Density, 'compact');
    await Promise.resolve();
    await Promise.resolve();
    expect(sink.records.map((r) => r.message)).toContain('Saving settings failed');
    settings.dispose();
  });
});
