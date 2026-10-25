import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { JsonBootStateStore } from '../updates/boot-state.ts';
import { Ed25519Verifier } from '../updates/ed25519-verifier.ts';
import { JsonFeedStateStore } from '../updates/feed-state.ts';
import { detectInstallType, updateFormat, type InstallFacts } from '../updates/install-type.ts';
import {
  AppImageRollback,
  NsisRollback,
  rollbackFor,
  updaterDirectory,
} from '../updates/rollback.ts';

const keyPair = (): { publicPem: string; sign: (data: string) => string } => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    publicPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    sign: (data) => sign(null, Buffer.from(data, 'utf8'), privateKey).toString('base64'),
  };
};

describe('Ed25519Verifier', () => {
  it('accepts signatures of the current key and its successor only', () => {
    const current = keyPair();
    const next = keyPair();
    const stranger = keyPair();
    const verifier = new Ed25519Verifier([current.publicPem, next.publicPem]);
    const data = '{"sequence":1,"note":"ä"}';
    expect(verifier.hasKeys).toBe(true);
    expect(verifier.verify(data, current.sign(data))).toBe(true);
    expect(verifier.verify(data, next.sign(data))).toBe(true);
    expect(verifier.verify(data, stranger.sign(data))).toBe(false);
    expect(verifier.verify(`${data} `, current.sign(data))).toBe(false);
    expect(verifier.verify(data, 'not base64 at all')).toBe(false);
    expect(new Ed25519Verifier([]).hasKeys).toBe(false);
  });
});

describe('JsonFeedStateStore', () => {
  let dir = '';
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('starts at 0 and keeps the last sequence', () => {
    dir = mkdtempSync(join(tmpdir(), 'feed-state-'));
    const path = join(dir, 'update-state.json');
    const store = new JsonFeedStateStore(path);
    expect(store.readSequence()).toBe(0);
    store.writeSequence(42);
    expect(new JsonFeedStateStore(path).readSequence()).toBe(42);
    writeFileSync(path, '{"sequence":"x"}');
    expect(store.readSequence()).toBe(0);
    writeFileSync(path, 'broken');
    expect(store.readSequence()).toBe(0);
  });
});

const facts = (overrides: Partial<InstallFacts>): InstallFacts => ({
  platform: 'linux',
  packaged: true,
  execPath: '/opt/Lampo/lampo',
  resourcesPath: '/opt/Lampo/resources',
  env: {},
  ...overrides,
});

describe('detectInstallType', () => {
  let dir = '';
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('tells the installation types apart', () => {
    dir = mkdtempSync(join(tmpdir(), 'install-'));
    expect(detectInstallType(facts({ packaged: false }))).toBe('unpacked');
    expect(detectInstallType(facts({ platform: 'darwin' }))).toBe('mac');
    const windows = { platform: 'win32', env: { ProgramFiles: 'C:\\Program Files' } } as const;
    expect(
      detectInstallType(facts({ ...windows, execPath: 'C:\\Program Files\\Lampo\\lampo.exe' })),
    ).toBe('msi');
    expect(
      detectInstallType(
        facts({ ...windows, execPath: 'C:\\Users\\a\\AppData\\Local\\Programs\\lampo\\lampo.exe' }),
      ),
    ).toBe('nsis');
    expect(detectInstallType(facts({ env: { APPIMAGE: '/home/a/lampo.AppImage' } }))).toBe(
      'appimage',
    );
    expect(detectInstallType(facts({ resourcesPath: dir }))).toBe('unpacked');
    writeFileSync(join(dir, 'package-type'), 'deb\n');
    expect(detectInstallType(facts({ resourcesPath: dir }))).toBe('deb');
    writeFileSync(join(dir, 'package-type'), 'rpm');
    expect(detectInstallType(facts({ resourcesPath: dir }))).toBe('rpm');
    writeFileSync(join(dir, 'package-type'), 'pacman');
    expect(detectInstallType(facts({ resourcesPath: dir }))).toBe('unpacked');
  });

  it('names the update format per installation type', () => {
    expect(['nsis', 'appimage', 'mac', 'msi'].map((t) => updateFormat(t as 'nsis'))).toEqual([
      'nsis',
      'appimage',
      'zip',
      undefined,
    ]);
  });
});

describe('JsonBootStateStore', () => {
  let dir = '';
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('reads what it wrote and falls back on invalid files', () => {
    dir = mkdtempSync(join(tmpdir(), 'boot-state-'));
    const path = join(dir, 'boot-state.json');
    const store = new JsonBootStateStore(path);
    expect(store.read()).toEqual({ blocked: [] });
    const state = {
      pending: { version: '0.2.0', previous: '0.1.0', attempts: 1 },
      blocked: ['0.1.5'],
    };
    store.write(state);
    expect(new JsonBootStateStore(path).read()).toEqual(state);
    for (const text of [
      '{"blocked":[1]}',
      '{"blocked":[],"pending":{"version":"x"}}',
      '{"pending":{}}',
      'null',
      'broken',
    ]) {
      writeFileSync(path, text);
      expect(store.read()).toEqual({ blocked: [] });
    }
  });
});

const chunksOf = async function* (...parts: string[]): AsyncIterable<Uint8Array> {
  for (const part of parts) {
    await Promise.resolve();
    yield Buffer.from(part);
  }
};

describe('rollback', () => {
  let dir = '';
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('keeps a copy of the AppImage and swaps it back', () => {
    dir = mkdtempSync(join(tmpdir(), 'rollback-'));
    const appImage = join(dir, 'lampo.AppImage');
    const launched: (readonly string[])[] = [];
    const rollback = new AppImageRollback(appImage, join(dir, 'state'), (file, args) =>
      launched.push([file, ...args]),
    );
    expect(rollback.restore([])).toBe(false);
    writeFileSync(appImage, 'version 1');
    rollback.keep();
    writeFileSync(appImage, 'version 2');
    expect(rollback.restore(['--flag'])).toBe(true);
    expect(readFileSync(appImage, 'utf8')).toBe('version 1');
    expect(launched).toEqual([[appImage, '--flag']]);
  });

  it('fetches and verifies the installer of the running version, then reinstalls it', async () => {
    dir = mkdtempSync(join(tmpdir(), 'rollback-'));
    const launched: (readonly string[])[] = [];
    const rollback = new NsisRollback(dir, (file, args) => launched.push([file, ...args]));
    expect(rollback.restore([])).toBe(false);
    const sha512 = createHash('sha512').update('installer 1').digest('base64');
    let downloads = 0;
    const download = (): Promise<{ sha512: string; chunks: AsyncIterable<Uint8Array> }> => {
      downloads += 1;
      return Promise.resolve({ sha512, chunks: chunksOf('installer', ' 1') });
    };
    await expect(
      rollback.prepare('0.1.0', () => Promise.resolve({ sha512, chunks: chunksOf('tampered') })),
    ).rejects.toThrow(/does not match/);
    await rollback.prepare('0.1.0', download);
    await rollback.prepare('0.1.0', download);
    expect(downloads).toBe(1);
    rollback.keep();
    expect(readFileSync(join(dir, 'installer-0.1.0.exe'), 'utf8')).toBe('installer 1');
    expect(rollback.restore([])).toBe(true);
    expect(launched).toEqual([
      [join(dir, 'installer-0.1.0.exe'), '/S', '--updated', '--force-run'],
    ]);
    writeFileSync(join(dir, 'installer.json'), '{"version":1}');
    expect(rollback.restore([])).toBe(false);
  });

  it('finds the per-user updater folder and the rollback per installation type', () => {
    expect(updaterDirectory('lampo', { LOCALAPPDATA: 'C:\\L' }, 'win32')).toBe(
      join('C:\\L', 'lampo-updater'),
    );
    expect(updaterDirectory('lampo', { XDG_CACHE_HOME: '/c' }, 'linux')).toBe(
      join('/c', 'lampo-updater'),
    );
    expect(updaterDirectory('lampo', {}, 'darwin')).toBe(
      join(homedir(), 'Library', 'Caches', 'lampo-updater'),
    );
    expect(updaterDirectory('lampo', {}, 'win32')).toContain('lampo-updater');
    expect(updaterDirectory('lampo', {}, 'linux')).toBe(join(homedir(), '.cache', 'lampo-updater'));
    const options = { directory: '/d', appImage: '/a.AppImage' };
    expect(rollbackFor('appimage', options)).toBeInstanceOf(AppImageRollback);
    expect(rollbackFor('appimage', { ...options, appImage: undefined })).toBeUndefined();
    expect(rollbackFor('nsis', options)).toBeInstanceOf(NsisRollback);
    expect(rollbackFor('mac', options)).toBeUndefined();
  });
});
