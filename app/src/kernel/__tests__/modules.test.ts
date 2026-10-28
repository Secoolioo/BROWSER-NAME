import { describe, expect, it, vi } from 'vitest';
import { Container } from '../di/container.ts';
import { token } from '../di/token.ts';
import { RingBufferLogSink, SinkLogger } from '../logging/logger.ts';
import { resolveActivation, type ActivationSource } from '../modules/activation.ts';
import {
  ModuleError,
  defineModule,
  type FeatureModule,
  type FeatureModuleClass,
  type ModuleContext,
  type ModuleManifest,
} from '../modules/manifest.ts';
import { ModuleHost } from '../modules/module-host.ts';
import { ModuleRegistry } from '../modules/registry.ts';
import { ManualClock } from '../time/clock.ts';
import { toDisposable } from '../../shared/disposable.ts';

/** Activation source backed by a map that tests can change. */
class MapSource implements ActivationSource {
  readonly values = new Map<string, boolean>();
  isEnabled(module: ModuleManifest): boolean | undefined {
    return this.values.get(module.id);
  }
}

const log: string[] = [];

/** Creates a module class that records activate, deactivate and cleanup calls. */
function recordingModule(id: string, options: { fail?: boolean } = {}): FeatureModuleClass {
  return class implements FeatureModule {
    static readonly inject = [] as const;
    activate(context: ModuleContext): void {
      if (options.fail === true) {
        throw new Error(`${id} broke`);
      }
      log.push(`activate ${id}`);
      context.subscriptions.add(toDisposable(() => log.push(`cleanup ${id}`)));
    }
    deactivate(): void {
      log.push(`deactivate ${id}`);
    }
  };
}

function manifest(
  id: string,
  extra: Partial<ModuleManifest> & { fail?: boolean } = {},
): ModuleManifest {
  const { fail, ...rest } = extra;
  const loader = vi.fn(() =>
    Promise.resolve({ default: recordingModule(id, { fail: fail ?? false }) }),
  );
  return defineModule({
    id,
    ...(rest.core === true ? {} : { activation: { default: true } }),
    main: loader,
    ...rest,
  });
}

function host(
  manifests: readonly ModuleManifest[],
  source = new MapSource(),
): {
  host: ModuleHost;
  source: MapSource;
  sink: RingBufferLogSink;
} {
  log.length = 0;
  const clock = new ManualClock();
  const sink = new RingBufferLogSink();
  const logger = new SinkLogger(sink, clock, { scope: 'kernel', level: 'trace' });
  const container = new Container();
  return {
    host: new ModuleHost(new ModuleRegistry(manifests), source, container, logger, clock),
    source,
    sink,
  };
}

describe('defineModule', () => {
  it('validates ids and activation rules', () => {
    expect(() => defineModule({ id: 'Bad_Id', activation: { default: true } })).toThrow(
      ModuleError,
    );
    expect(() => defineModule({ id: 'tabs' })).toThrow(/needs an activation/);
    expect(() => defineModule({ id: 'tabs', core: true, activation: { default: true } })).toThrow(
      /cannot be switched off/,
    );
    expect(() =>
      defineModule({ id: 'loop', dependsOn: ['loop'], activation: { default: true } }),
    ).toThrow(/depends on itself/);
    expect(Object.isFrozen(defineModule({ id: 'tab-groups', core: true }))).toBe(true);
  });
});

describe('ModuleRegistry', () => {
  it('rejects duplicates, unknown dependencies, core-on-optional and cycles', () => {
    expect(() => new ModuleRegistry([manifest('a'), manifest('a')])).toThrow(/registered twice/);
    expect(() => new ModuleRegistry([manifest('a', { dependsOn: ['x'] })])).toThrow(/unknown "x"/);
    expect(
      () =>
        new ModuleRegistry([manifest('opt'), manifest('core', { core: true, dependsOn: ['opt'] })]),
    ).toThrow(/cannot depend on optional/);
    expect(
      () =>
        new ModuleRegistry([
          manifest('a', { dependsOn: ['b'] }),
          manifest('b', { dependsOn: ['a'] }),
        ]),
    ).toThrow('Module dependency cycle: a -> b -> a');
  });

  it('orders dependencies first and keeps registration order otherwise', () => {
    const registry = new ModuleRegistry([
      manifest('c', { dependsOn: ['b'] }),
      manifest('a'),
      manifest('b'),
    ]);
    expect(registry.topologicalOrder().map((m) => m.id)).toEqual(['b', 'c', 'a']);
    expect(registry.get('a')?.id).toBe('a');
    expect(registry.all().map((m) => m.id)).toEqual(['c', 'a', 'b']);
  });
});

describe('resolveActivation', () => {
  it('honours the source, defaults, core modules and dependencies', () => {
    const source = new MapSource();
    source.values.set('workspaces', false);
    const registry = new ModuleRegistry([
      manifest('tabs', { core: true }),
      manifest('workspaces', { dependsOn: ['tabs'] }),
      manifest('workspace-rules', { dependsOn: ['workspaces'] }),
      manifest('reader', { activation: { default: false } }),
    ]);
    const plan = resolveActivation(registry, source);
    expect(plan.active.map((m) => m.id)).toEqual(['tabs']);
    expect(plan.inactive.get('workspaces')).toEqual({ kind: 'disabled' });
    expect(plan.inactive.get('workspace-rules')).toEqual({
      kind: 'dependency',
      dependency: 'workspaces',
    });
    expect(plan.inactive.get('reader')).toEqual({ kind: 'disabled' });
  });
});

describe('ModuleHost', () => {
  it('activates in dependency order and never imports disabled modules', async () => {
    const reader = manifest('reader', { activation: { default: false } });
    const { host: moduleHost } = host([
      manifest('workspaces', { dependsOn: ['tabs'] }),
      manifest('tabs', { core: true }),
      reader,
    ]);
    await moduleHost.start();
    expect(log).toEqual(['activate tabs', 'activate workspaces']);
    expect(reader.main).not.toHaveBeenCalled();
    expect(moduleHost.isActive('workspaces')).toBe(true);
    expect(moduleHost.status()).toEqual([
      expect.objectContaining({ id: 'workspaces', state: 'active' }),
      expect.objectContaining({ id: 'tabs', state: 'active' }),
      { id: 'reader', state: 'inactive', reason: { kind: 'disabled' } },
    ]);
    await expect(moduleHost.start()).resolves.toBeUndefined();
  });

  it('switches modules off and on at runtime, cleaning up dependents first', async () => {
    const { host: moduleHost, source } = host([
      manifest('tabs', { core: true }),
      manifest('workspaces', { dependsOn: ['tabs'] }),
      manifest('workspace-rules', { dependsOn: ['workspaces'] }),
    ]);
    await moduleHost.start();
    log.length = 0;
    source.values.set('workspaces', false);
    await moduleHost.refresh();
    expect(log).toEqual([
      'deactivate workspace-rules',
      'cleanup workspace-rules',
      'deactivate workspaces',
      'cleanup workspaces',
    ]);
    expect(moduleHost.status()[2]).toEqual({
      id: 'workspace-rules',
      state: 'inactive',
      reason: { kind: 'dependency', dependency: 'workspaces' },
    });
    log.length = 0;
    source.values.delete('workspaces');
    await moduleHost.refresh();
    expect(log).toEqual(['activate workspaces', 'activate workspace-rules']);
  });

  it('isolates a failing optional module and keeps its dependents inactive', async () => {
    const { host: moduleHost, sink } = host([
      manifest('tabs', { core: true }),
      manifest('broken', { fail: true }),
      manifest('needs-broken', { dependsOn: ['broken'] }),
      manifest('fine'),
    ]);
    await moduleHost.start();
    expect(moduleHost.status()).toEqual([
      expect.objectContaining({ id: 'tabs', state: 'active' }),
      { id: 'broken', state: 'failed', error: 'broken broke' },
      {
        id: 'needs-broken',
        state: 'inactive',
        reason: { kind: 'dependency', dependency: 'broken' },
      },
      expect.objectContaining({ id: 'fine', state: 'active' }),
    ]);
    expect(sink.records.some((r) => r.message === 'Module broken failed to activate')).toBe(true);
    await moduleHost.refresh();
    expect(moduleHost.status()[1]?.state).toBe('failed');
  });

  it('fails the start when a core module fails', async () => {
    const { host: moduleHost } = host([manifest('tabs', { core: true, fail: true })]);
    await expect(moduleHost.start()).rejects.toThrow('Core module "tabs" failed to activate');
  });

  it('only marks restart-required modules instead of switching them at runtime', async () => {
    const { host: moduleHost, source } = host([
      manifest('gpu', { restartRequired: true }),
      manifest('extras', { restartRequired: true, activation: { default: false } }),
    ]);
    await moduleHost.start();
    source.values.set('gpu', false);
    source.values.set('extras', true);
    await moduleHost.refresh();
    expect(moduleHost.isActive('gpu')).toBe(true);
    expect(moduleHost.isActive('extras')).toBe(false);
    expect(moduleHost.status().map((s) => s.state)).toEqual([
      'restart-required',
      'restart-required',
    ]);
  });

  it('gives each module a private container and reports status changes', async () => {
    const PrivateToken = token<string>('Private');
    let seen: ModuleContext | undefined;
    const withServices = defineModule({
      id: 'with-services',
      activation: { default: true },
      main: () =>
        Promise.resolve({
          default: class implements FeatureModule {
            static readonly inject: readonly [] = [];
            activate(context: ModuleContext): void {
              context.services.registerValue(PrivateToken, 'mine');
              seen = context;
            }
          },
        }),
    });
    const { host: moduleHost } = host([withServices]);
    const changes = vi.fn();
    moduleHost.onDidChangeStatus(changes);
    await moduleHost.start();
    expect(seen?.services.resolve(PrivateToken)).toBe('mine');
    expect(seen?.logger.scope).toBe('kernel.module.with-services');
    expect(changes).toHaveBeenCalledWith(expect.objectContaining({ state: 'active' }));
    await moduleHost.stop();
    expect(seen?.services.isDisposed).toBe(true);
    expect(seen?.subscriptions.isDisposed).toBe(true);
  });

  it('logs deactivate errors, activates manifests without code and disposes on dispose', async () => {
    const throwing = defineModule({
      id: 'throwing',
      activation: { default: true },
      main: () =>
        Promise.resolve({
          default: class implements FeatureModule {
            static readonly inject: readonly [] = [];
            activate(): void {}
            deactivate(): void {
              throw new Error('no');
            }
          },
        }),
    });
    const dataOnly = defineModule({ id: 'data-only', activation: { default: true } });
    const { host: moduleHost, sink, source } = host([throwing, dataOnly]);
    await moduleHost.start();
    expect(moduleHost.isActive('data-only')).toBe(true);
    source.values.set('throwing', false);
    await moduleHost.refresh();
    expect(sink.records.some((r) => r.message === 'Module throwing failed to deactivate')).toBe(
      true,
    );
    moduleHost.dispose();
    expect(moduleHost.isActive('data-only')).toBe(false);
  });
});
