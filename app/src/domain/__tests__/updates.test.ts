import { describe, expect, it } from 'vitest';
import { RingBufferLogSink, SinkLogger } from '../../kernel/logging/logger.ts';
import { ManualClock } from '../../kernel/time/clock.ts';
import { BootGuard, type BootState, type BootStateStore } from '../updates/boot-guard.ts';
import {
  FeedError,
  SignedFeed,
  selectRelease,
  type FeedIndex,
  type FeedFetcher,
  type FeedStateStore,
  type ReleaseQuery,
  type SignatureVerifier,
} from '../updates/feed.ts';
import { updateMode, updatePolicies } from '../updates/update-policies.ts';
import {
  UpdateService,
  updatesItself,
  type UpdateEngine,
  type UpdateServiceOptions,
  type UpdateState,
} from '../updates/update-service.ts';
import {
  compareVersions,
  isVersion,
  matchesVersionPrefix,
  parseVersion,
} from '../updates/version.ts';

describe('versions', () => {
  it('orders versions by semantic version precedence', () => {
    const ordered = [
      '0.1.0-alpha',
      '0.1.0-alpha.1',
      '0.1.0-beta',
      '0.1.0-beta.2',
      '0.1.0-beta.10',
      '0.1.0',
      '0.1.1',
      '0.2.0',
      '1.0.0',
    ];
    expect(ordered.toReversed().toSorted(compareVersions)).toEqual(ordered);
    expect(compareVersions('1.2.3+build.5', '1.2.3')).toBe(0);
    expect(compareVersions('1.0.0-1', '1.0.0-a')).toBeLessThan(0);
  });

  it('parses only semantic versions', () => {
    expect(parseVersion('0.1.0-beta.2')).toEqual({
      major: 0,
      minor: 1,
      patch: 0,
      prerelease: ['beta', 2],
    });
    expect(['1', '1.2', '01.2.3', '1.2.3-', 'v1.2.3', '1.2.3-beta..1'].filter(isVersion)).toEqual(
      [],
    );
    expect(() => compareVersions('x', '1.0.0')).toThrow(RangeError);
    expect(() => compareVersions('1.0.0', 'y')).toThrow(/y/);
  });

  it('matches whole version components of a prefix', () => {
    expect(matchesVersionPrefix('0.1.4', '0.1')).toBe(true);
    expect(matchesVersionPrefix('0.1.4', '0.1.')).toBe(true);
    expect(matchesVersionPrefix('0.10.0', '0.1')).toBe(false);
    expect(matchesVersionPrefix('0.1.0-beta.1', '0.1.0')).toBe(true);
    expect(matchesVersionPrefix('2.0.0', '')).toBe(true);
  });
});

const index = (overrides: Partial<FeedIndex> = {}): FeedIndex => ({
  schemaVersion: 1,
  sequence: 5,
  issuedAt: '2026-10-01T00:00:00.000Z',
  expiresAt: '2026-10-31T00:00:00.000Z',
  releases: [
    { version: '0.1.0-beta.1', channel: 'beta' },
    { version: '0.1.0-beta.2', channel: 'beta' },
    { version: '0.1.0', channel: 'stable' },
    { version: '0.2.0-beta.1', channel: 'beta' },
  ],
  ...overrides,
});

const query = (overrides: Partial<ReleaseQuery> = {}): ReleaseQuery => ({
  channel: 'stable',
  currentVersion: '0.1.0-beta.1',
  artifactKey: 'linux-x64-appimage',
  ...overrides,
});

describe('selectRelease', () => {
  it('picks the newest release of the channel; beta also receives stable', () => {
    expect(selectRelease(index(), query())).toBe('0.1.0');
    expect(selectRelease(index(), query({ channel: 'beta' }))).toBe('0.2.0-beta.1');
  });

  it('skips versions that failed to start here', () => {
    expect(selectRelease(index(), query({ channel: 'beta', blocked: ['0.2.0-beta.1'] }))).toBe(
      '0.1.0',
    );
  });

  it('honors the version prefix and never downgrades', () => {
    expect(selectRelease(index(), query({ channel: 'beta', versionPrefix: '0.1' }))).toBe('0.1.0');
    expect(selectRelease(index(), query({ currentVersion: '0.1.0' }))).toBeUndefined();
    expect(selectRelease(index(), query({ currentVersion: '0.3.0', channel: 'beta' }))).toBe(
      undefined,
    );
  });
});

/** Signs by length and content, so any change to the data breaks the signature. */
const fakeSign = (data: string): string => `sig:${data.length}:${data.slice(-8)}`;
const verifier: SignatureVerifier = { verify: (data, signature) => fakeSign(data) === signature };

class MemoryFeed implements FeedFetcher {
  readonly files = new Map<string, string>();
  put(path: string, content: unknown, signature?: string): void {
    const data = typeof content === 'string' ? content : JSON.stringify(content);
    this.files.set(path, data);
    this.files.set(`${path}.sig`, `${signature ?? fakeSign(data)}\n`);
  }
  fetch(path: string): Promise<string | undefined> {
    return Promise.resolve(this.files.get(path));
  }
}

class MemoryState implements FeedStateStore {
  sequence = 0;
  readSequence(): number {
    return this.sequence;
  }
  writeSequence(sequence: number): void {
    this.sequence = sequence;
  }
}

const manifest = {
  schemaVersion: 1,
  version: '0.1.0',
  releaseDate: '2026-10-01T00:00:00.000Z',
  downloadBase: 'https://example.test/download/v0.1.0/',
  artifacts: {
    'linux-x64-appimage': {
      file: 'astela-linux-x86_64.AppImage',
      size: 10,
      sha512: 'AAAA',
      blockMapSize: 4,
    },
  },
};

const failure = async (feed: SignedFeed, q = query()): Promise<string> => {
  try {
    await feed.findUpdate(q);
  } catch (error) {
    return error instanceof FeedError ? error.code : 'other';
  }
  return 'none';
};

describe('SignedFeed', () => {
  const now = Date.parse('2026-10-15T00:00:00.000Z');
  const setup = (): { fetcher: MemoryFeed; state: MemoryState; feed: SignedFeed } => {
    const fetcher = new MemoryFeed();
    fetcher.put('updates/v1/index.json', index());
    fetcher.put('updates/v1/releases/0.1.0.json', manifest);
    const state = new MemoryState();
    return { fetcher, state, feed: new SignedFeed(fetcher, verifier, state, () => now) };
  };

  it('returns the verified release and remembers the sequence', async () => {
    const { feed, state } = setup();
    const update = await feed.findUpdate(query());
    expect(update?.manifest.version).toBe('0.1.0');
    expect(update?.artifact.file).toBe('astela-linux-x86_64.AppImage');
    expect(state.sequence).toBe(5);
    expect(await feed.findUpdate(query({ currentVersion: '0.1.0' }))).toBeUndefined();
  });

  it('rejects bad signatures, tampering and missing files', async () => {
    const { feed, fetcher } = setup();
    fetcher.put('updates/v1/index.json', index(), 'sig:0:');
    expect(await failure(feed)).toBe('signature');
    const signature = fetcher.files.get('updates/v1/index.json.sig') ?? '';
    fetcher.put('updates/v1/index.json', index());
    fetcher.files.set('updates/v1/index.json', `${JSON.stringify(index())} `);
    fetcher.files.set('updates/v1/index.json.sig', signature);
    expect(await failure(feed)).toBe('signature');
    fetcher.files.delete('updates/v1/index.json');
    expect(await failure(feed)).toBe('unavailable');
  });

  it('rejects rollbacks, expired feeds and invalid content', async () => {
    const { feed, fetcher, state } = setup();
    state.sequence = 6;
    expect(await failure(feed)).toBe('rollback');
    state.sequence = 0;
    fetcher.put('updates/v1/index.json', index({ expiresAt: '2026-10-14T00:00:00.000Z' }));
    expect(await failure(feed)).toBe('expired');
    expect(state.sequence).toBe(0);
    fetcher.put('updates/v1/index.json', '{not json');
    expect(await failure(feed)).toBe('invalid');
    fetcher.put('updates/v1/index.json', { ...index(), sequence: -1 });
    expect(await failure(feed)).toBe('invalid');
  });

  it('loads the verified manifest of any version', async () => {
    const { feed } = setup();
    expect((await feed.manifest('0.1.0')).artifacts['linux-x64-appimage']?.size).toBe(10);
    await expect(feed.manifest('0.0.9')).rejects.toThrow(FeedError);
  });

  it('rejects manifests that do not match or have no file for this platform', async () => {
    const { feed, fetcher } = setup();
    expect(await failure(feed, query({ artifactKey: 'win32-arm64-nsis' }))).toBe('no-artifact');
    fetcher.put('updates/v1/releases/0.1.0.json', { ...manifest, version: '0.1.1' });
    expect(await failure(feed)).toBe('mismatch');
    fetcher.put('updates/v1/releases/0.1.0.json', {
      ...manifest,
      artifacts: {
        'linux-x64-appimage': { ...manifest.artifacts['linux-x64-appimage'], file: '../x' },
      },
    });
    expect(await failure(feed)).toBe('invalid');
  });
});

class FakeEngine implements UpdateEngine {
  available: string | undefined = '0.2.0';
  checks = 0;
  installs = 0;
  error: Error | undefined;
  check(): Promise<string | undefined> {
    this.checks += 1;
    if (this.error !== undefined) return Promise.reject(this.error);
    return Promise.resolve(this.available);
  }
  download(onProgress: (percent: number) => void): Promise<void> {
    onProgress(50.4);
    onProgress(100);
    return Promise.resolve();
  }
  install(): void {
    this.installs += 1;
  }
}

// The domain has no host timers; flushing the microtask queue lets a check finish.
const settle = async (): Promise<void> => {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
};

const make = (
  options: Partial<UpdateServiceOptions> = {},
): { service: UpdateService; engine: FakeEngine; clock: ManualClock; states: UpdateState[] } => {
  const clock = new ManualClock(0, 1_000_000);
  const engine = new FakeEngine();
  const logger = new SinkLogger(new RingBufferLogSink(50), clock, { scope: 'test' });
  const service = new UpdateService(engine, clock, logger, {
    mode: 'automatic',
    installType: 'appimage',
    hasKeys: true,
    periodMinutes: 240,
    isOnline: () => true,
    random: () => 0.5,
    ...options,
  });
  const states: UpdateState[] = [];
  service.onDidChange((state) => states.push(state));
  return { service, engine, clock, states };
};

describe('UpdateService', () => {
  const minute = 60_000;

  it('is disabled by policy, installation type or missing keys', async () => {
    expect(make({ mode: 'off' }).service.state).toEqual({ kind: 'disabled', reason: 'policy' });
    expect(make({ installType: 'msi' }).service.state).toEqual({
      kind: 'disabled',
      reason: 'install-type',
    });
    const { service, engine } = make({ hasKeys: false });
    expect(service.state).toEqual({ kind: 'disabled', reason: 'no-keys' });
    expect(await service.check()).toEqual(service.state);
    service.start();
    expect(engine.checks).toBe(0);
    expect(['nsis', 'mac', 'appimage'].every((t) => updatesItself(t as 'nsis'))).toBe(true);
    expect(updatesItself('deb')).toBe(false);
  });

  it('checks 30 to 60 seconds after start, downloads and installs on exit', async () => {
    const { service, engine, clock, states } = make();
    service.start();
    clock.advance(44_999);
    expect(engine.checks).toBe(0);
    clock.advance(1);
    await settle();
    expect(engine.checks).toBe(1);
    expect(states.map((s) => s.kind)).toEqual([
      'checking',
      'downloading',
      'downloading',
      'downloading',
      'ready',
    ]);
    expect(states[2]).toEqual({ kind: 'downloading', version: '0.2.0', percent: 50 });
    expect(await service.check()).toEqual({ kind: 'ready', version: '0.2.0' });
    clock.advance(500 * minute);
    expect(engine.checks).toBe(1);
    expect(service.installOnExit()).toBe(true);
    expect(engine.installs).toBe(1);
    service.dispose();
  });

  it('checks again after the period, retries later while offline, and reports failures', async () => {
    let online = false;
    const { service, engine, clock } = make({ isOnline: () => online });
    engine.available = undefined;
    service.start();
    clock.advance(45_000);
    expect(engine.checks).toBe(0);
    online = true;
    clock.advance(15 * minute);
    await settle();
    expect(engine.checks).toBe(1);
    expect(service.state).toEqual({ kind: 'idle', lastCheckAt: 1_000_000 + 45_000 + 15 * minute });
    expect(service.installOnExit()).toBe(false);
    engine.error = Object.assign(new Error('bad signature'), { code: 'signature' });
    clock.advance(240 * minute);
    await settle();
    expect(engine.checks).toBe(2);
    expect(service.state).toMatchObject({
      kind: 'failed',
      code: 'signature',
      message: 'bad signature',
    });
    engine.error = new Error('plain');
    clock.advance(240 * minute);
    await settle();
    expect(service.state).toMatchObject({ kind: 'failed', code: 'error' });
    service.dispose();
  });

  it('prepares the rollback after a download and before the installation', async () => {
    const calls: string[] = [];
    const { service } = make({
      hooks: {
        afterDownload: (version) => {
          calls.push(`after ${version}`);
          return Promise.reject(new Error('offline'));
        },
        beforeInstall: (version) => calls.push(`before ${version}`),
      },
    });
    expect(await service.check()).toEqual({ kind: 'ready', version: '0.2.0' });
    expect(service.installOnExit()).toBe(true);
    expect(calls).toEqual(['after 0.2.0', 'before 0.2.0']);
  });

  it('only checks on request in manual mode and shares concurrent checks', async () => {
    const { service, engine, clock } = make({ mode: 'manual' });
    service.start();
    clock.advance(60 * minute);
    expect(engine.checks).toBe(0);
    const [first, second] = await Promise.all([service.check(), service.check()]);
    expect(first).toBe(second);
    expect(engine.checks).toBe(1);
  });
});

describe('update policies', () => {
  it('maps the update policy to a mode', () => {
    expect([updateMode(0), updateMode(1), updateMode(2), updateMode(undefined)]).toEqual([
      'off',
      'automatic',
      'manual',
      'automatic',
    ]);
    expect(updatePolicies.map((p) => p.name)).toContain('UpdateURL');
  });
});

class MemoryBootState implements BootStateStore {
  state: BootState = { blocked: [] };
  read(): BootState {
    return this.state;
  }
  write(state: BootState): void {
    this.state = state;
  }
}

describe('BootGuard', () => {
  it('lets an update prove itself and forgets it once healthy', () => {
    const store = new MemoryBootState();
    const guard = new BootGuard(store);
    expect(guard.beginBoot('0.1.0')).toEqual({ kind: 'normal' });
    guard.prepareUpdate('0.1.0', '0.2.0');
    expect(store.state.pending).toEqual({ version: '0.2.0', previous: '0.1.0', attempts: 0 });
    expect(guard.beginBoot('0.2.0')).toEqual({ kind: 'trial', attempt: 1 });
    guard.markHealthy('0.1.0');
    expect(store.state.pending?.attempts).toBe(1);
    guard.markHealthy('0.2.0');
    expect(store.state).toEqual({ blocked: [] });
    expect(guard.beginBoot('0.2.0')).toEqual({ kind: 'normal' });
  });

  it('rolls back after two failed starts and blocks the version', () => {
    const store = new MemoryBootState();
    const guard = new BootGuard(store);
    guard.prepareUpdate('0.1.0', '0.2.0');
    expect(guard.beginBoot('0.2.0')).toEqual({ kind: 'trial', attempt: 1 });
    expect(guard.beginBoot('0.2.0')).toEqual({ kind: 'trial', attempt: 2 });
    expect(guard.beginBoot('0.2.0')).toEqual({
      kind: 'rollback',
      failed: '0.2.0',
      previous: '0.1.0',
    });
    expect(guard.blockedVersions()).toEqual(['0.2.0']);
    expect(store.state.pending).toBeUndefined();
    expect(guard.beginBoot('0.1.0')).toEqual({ kind: 'normal' });
  });

  it('ignores a pending update that never arrived', () => {
    const store = new MemoryBootState();
    const guard = new BootGuard(store);
    guard.prepareUpdate('0.1.0', '0.2.0');
    expect(guard.beginBoot('0.1.0')).toEqual({ kind: 'normal' });
    expect(store.state).toEqual({ blocked: [] });
  });
});
