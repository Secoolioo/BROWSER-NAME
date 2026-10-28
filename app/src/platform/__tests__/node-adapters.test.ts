import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ManualClock } from '../../kernel/time/clock.ts';
import { writeFileAtomic, writeFileAtomicSync } from '../node/atomic-file.ts';
import { RotatingFileLogSink } from '../node/file-log-sink.ts';
import { JsonFileSettingsStore } from '../node/json-settings-store.ts';
import { SystemClock } from '../node/system-clock.ts';
import { createPolicyProviders } from '../policy/platform-providers.ts';

const dirs: string[] = [];
const tempDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'adapters-'));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('atomic writes', () => {
  it('writes files and leaves no temporary files', async () => {
    const dir = tempDir();
    await writeFileAtomic(join(dir, 'a', 'x.json'), '{"a":1}');
    writeFileAtomicSync(join(dir, 'b', 'y.json'), new TextEncoder().encode('ok'));
    writeFileAtomicSync(join(dir, 'b', 'z.txt'), 'text');
    expect(readFileSync(join(dir, 'a', 'x.json'), 'utf8')).toBe('{"a":1}');
    expect(readFileSync(join(dir, 'b', 'y.json'), 'utf8')).toBe('ok');
    expect(readdirSync(join(dir, 'b')).toSorted()).toEqual(['y.json', 'z.txt']);
  });
});

const record = (n: number) => ({
  time: n,
  level: 'info' as const,
  scope: 's',
  message: 'x'.repeat(40),
});

describe('RotatingFileLogSink', () => {
  it('writes JSON lines and keeps a limited number of rotated files', () => {
    const dir = tempDir();
    const sink = new RotatingFileLogSink({
      directory: join(dir, 'logs'),
      name: 'main',
      maxBytes: 200,
      keep: 2,
    });
    for (let i = 0; i < 12; i += 1) {
      sink.write(record(i));
    }
    const files = readdirSync(join(dir, 'logs')).toSorted();
    expect(files).toEqual(['main.1.log', 'main.2.log', 'main.log']);
    const last = readFileSync(join(dir, 'logs', 'main.log'), 'utf8')
      .trim()
      .split('\n');
    expect(JSON.parse(last.at(-1) ?? '{}')).toMatchObject({ time: 11 });
  });

  it('never throws when the directory cannot be written', () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'blocked'), 'file, not a directory');
    const sink = new RotatingFileLogSink({ directory: join(dir, 'blocked'), name: 'main' });
    expect(() => sink.write(record(1))).not.toThrow();
  });
});

describe('JsonFileSettingsStore', () => {
  it('debounces writes, sorts keys and writes rejected values separately', async () => {
    const dir = tempDir();
    const clock = new ManualClock();
    const store = new JsonFileSettingsStore(
      join(dir, 'settings.json'),
      join(dir, 'rejected.json'),
      clock,
      300,
    );
    const first = store.save({ user: { b: 1, a: 2 }, workspaces: {} }, []);
    const second = store.save({ user: { b: 2, a: 2 }, workspaces: { w: { z: 1, y: 0 } } }, [
      { key: 'k', value: 1, message: 'bad' },
    ]);
    expect(existsSync(join(dir, 'settings.json'))).toBe(false);
    clock.advance(300);
    await Promise.all([first, second]);
    expect(readFileSync(join(dir, 'settings.json'), 'utf8')).toBe(
      `${JSON.stringify({ $schemaVersion: 1, user: { a: 2, b: 2 }, workspaces: { w: { y: 0, z: 1 } } }, null, 2)}\n`,
    );
    expect(JSON.parse(readFileSync(join(dir, 'rejected.json'), 'utf8'))).toEqual([
      { key: 'k', value: 1, message: 'bad' },
    ]);
    expect(await store.load()).toEqual({ user: { a: 2, b: 2 }, workspaces: { w: { y: 0, z: 1 } } });
    await store.flush();
    store.dispose();
  });

  it('starts empty without a file and moves a corrupt file aside', async () => {
    const dir = tempDir();
    const clock = new ManualClock(0, 42);
    const store = new JsonFileSettingsStore(
      join(dir, 'settings.json'),
      join(dir, 'rejected.json'),
      clock,
    );
    expect(await store.load()).toEqual({ user: {}, workspaces: {} });
    writeFileSync(join(dir, 'settings.json'), '{ broken');
    expect(await store.load()).toEqual({ user: {}, workspaces: {} });
    expect(existsSync(join(dir, 'settings.json.corrupt-42'))).toBe(true);
    writeFileSync(join(dir, 'settings.json'), '[1]');
    expect(await store.load()).toEqual({ user: {}, workspaces: {} });
    writeFileSync(join(dir, 'settings.json'), '{"user": 1, "workspaces": {"a": {"x": 1}, "b": 2}}');
    expect(await store.load()).toEqual({ user: {}, workspaces: { a: { x: 1 } } });
  });

  it('reports write failures to every waiting caller', async () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'blocked'), 'file');
    const clock = new ManualClock();
    const store = new JsonFileSettingsStore(
      join(dir, 'blocked', 'settings.json'),
      join(dir, 'r.json'),
      clock,
    );
    const saved = store.save({ user: {}, workspaces: {} }, []);
    clock.advance(300);
    await expect(saved).rejects.toThrow(/ENOTDIR|EEXIST|ENOENT/);
  });
});

describe('SystemClock', () => {
  it('measures time and runs and cancels timers', async () => {
    const clock = new SystemClock();
    expect(clock.wallTime()).toBeGreaterThan(1_700_000_000_000);
    const start = clock.now();
    let fired = false;
    clock.setTimeout(() => (fired = true), 1);
    let cancelled = false;
    clock.setTimeout(() => (cancelled = true), 1).dispose();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fired).toBe(true);
    expect(cancelled).toBe(false);
    expect(clock.now()).toBeGreaterThan(start);
  });
});

describe('createPolicyProviders', () => {
  const brand = {
    productName: 'Astela',
    slug: 'astela',
    appId: 'io.example.astela',
    repository: 'o/r',
    website: 'https://x/',
    tagline: '',
  };
  it('picks the provider of the platform', () => {
    expect(createPolicyProviders(brand, 'win32').map((p) => p.name)).toEqual(['windows-registry']);
    expect(createPolicyProviders(brand, 'darwin').map((p) => p.name)).toEqual([
      'macos-managed-preferences',
    ]);
    expect(createPolicyProviders(brand, 'linux').map((p) => p.name)).toEqual(['linux-json']);
  });
});
