import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Ed25519Verifier } from '../updates/ed25519-verifier.ts';
import { JsonFeedStateStore } from '../updates/feed-state.ts';
import { detectInstallType, updateFormat, type InstallFacts } from '../updates/install-type.ts';

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
