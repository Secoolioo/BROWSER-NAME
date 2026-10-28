import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PlistError, parsePlist } from '../policy/plist.ts';
import {
  JsonFilePolicyCache,
  LinuxJsonPolicyProvider,
  MacManagedPreferencesPolicyProvider,
  WindowsRegistryPolicyProvider,
  nodePolicyIo,
  type PolicyIo,
} from '../policy/policy-providers.ts';
import { parseRegistryExport, registryPolicies } from '../policy/registry-export.ts';

const root = 'SOFTWARE\\Policies\\Astela';

/** UTF-16LE hex bytes of a string, as `reg export` writes them for hex(2) and hex(7). */
const utf16 = (text: string): string =>
  Array.from({ length: text.length }, (_, i) => text.charCodeAt(i))
    .flatMap((code) => [code & 0xff, code >> 8])
    .map((b) => b.toString(16).padStart(2, '0'))
    .join(',');

const registryExport = [
  '﻿Windows Registry Editor Version 5.00',
  '',
  `[HKEY_LOCAL_MACHINE\\${root}]`,
  '"UpdatePolicy"=dword:00000002',
  '"HomepageLocation"="https://intranet.example/stra\\"ße"',
  '"DownloadDirectory"=hex(2):' + utf16('%USERPROFILE%\\Downloads\0'),
  '"AutoUpdateCheckPeriodMinutes"=hex(b):f0,00,00,00,00,00,00,00',
  '"Blob"=hex:01,02',
  `"ProxyBypassList"=hex(7):${utf16('a.example\0')},\\`,
  `  ${utf16('b.example\0\0')}`,
  '',
  `[HKEY_LOCAL_MACHINE\\${root}\\URLBlocklist]`,
  '"2"="ads.example"',
  '"1"="tracker.example"',
  '"note"="ignored"',
  '',
  `[HKEY_LOCAL_MACHINE\\${root}\\Recommended]`,
  '"TabStripPosition"="left"',
  '',
  `[HKEY_LOCAL_MACHINE\\${root}\\Too\\Deep]`,
  '"X"="y"',
  '',
  '[HKEY_LOCAL_MACHINE\\SOFTWARE\\Other]',
  '"Foreign"="value"',
].join('\r\n');

describe('reg export parsing', () => {
  it('reads every supported value type and maps keys to policies', () => {
    const keys = parseRegistryExport(registryExport);
    expect(keys).toHaveLength(5);
    const { values, errors } = registryPolicies(keys, root, 'machine');
    const byName = Object.fromEntries(values.map((v) => [v.name, v]));
    expect(byName['UpdatePolicy']?.value).toBe(2);
    expect(byName['HomepageLocation']?.value).toBe('https://intranet.example/stra"ße');
    expect(byName['DownloadDirectory']?.value).toBe('%USERPROFILE%\\Downloads');
    expect(byName['AutoUpdateCheckPeriodMinutes']?.value).toBe(240);
    expect(byName['ProxyBypassList']?.value).toEqual(['a.example', 'b.example']);
    expect(byName['URLBlocklist']).toMatchObject({
      value: ['tracker.example', 'ads.example'],
      level: 'mandatory',
      source: `HKLM\\${root}\\URLBlocklist`,
    });
    expect(byName['TabStripPosition']).toMatchObject({ value: 'left', level: 'recommended' });
    expect(byName['Foreign']).toBeUndefined();
    expect(errors.map((e) => e.message)).toEqual([
      'Value Blob has an unsupported registry type',
      'Nested policy keys are not supported',
    ]);
  });

  it('only accepts keys of the matching hive', () => {
    const keys = parseRegistryExport(registryExport);
    expect(registryPolicies(keys, root, 'user').values).toEqual([]);
  });
});

describe('plist parsing', () => {
  it('parses all supported types', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>UpdatePolicy</key><integer>1</integer>
  <key>Zoom</key><real>1.25</real>
  <key>DeveloperToolsAvailability</key><false/>
  <key>PrivateModeAvailability</key><true/>
  <key>HomepageLocation</key><string>https://intranet.example/?a=1&amp;b=&#x32;</string>
  <key>Empty</key><string/>
  <key>URLBlocklist</key><array><string>ads.example</string><string></string></array>
  <key>Nested</key><dict><key>a</key><array/></dict>
  <key>Since</key><date>2026-10-01T00:00:00Z</date>
  <key>Blob</key><data>AQI=</data>
  <key>None</key><dict/>
</dict>
</plist>`;
    expect(parsePlist(xml)).toEqual({
      UpdatePolicy: 1,
      Zoom: 1.25,
      DeveloperToolsAvailability: false,
      PrivateModeAvailability: true,
      HomepageLocation: 'https://intranet.example/?a=1&b=2',
      Empty: '',
      URLBlocklist: ['ads.example', ''],
      Nested: { a: [] },
      Since: new Date('2026-10-01T00:00:00Z'),
      Blob: Uint8Array.from([1, 2]),
      None: {},
    });
  });

  it('rejects malformed documents', () => {
    expect(() => parsePlist('<dict/>')).toThrow(PlistError);
    expect(() => parsePlist('<plist><dict><string>x</string></dict></plist>')).toThrow(
      /Expected <key>/,
    );
    expect(() => parsePlist('<plist><integer>x</integer></plist>')).toThrow(/Invalid number/);
    expect(() => parsePlist('<plist><set/></plist>')).toThrow(/Unsupported/);
    expect(() => parsePlist('<plist><dict></dict>')).toThrow(/Expected <\/plist>/);
  });
});

/** In-memory {@link PolicyIo}. */
class FakeIo implements PolicyIo {
  readonly files = new Map<string, Uint8Array>();
  readonly commands: string[] = [];
  outputs: Record<string, { status: number | null; stdout: string; writes?: Uint8Array }> = {};
  run(command: string, args: readonly string[]): { status: number | null; stdout: string } {
    const key = `${command} ${args.join(' ')}`;
    this.commands.push(key);
    const output = Object.entries(this.outputs).find(([prefix]) => key.startsWith(prefix))?.[1];
    if (output?.writes !== undefined && args[2] !== undefined) {
      this.files.set(args[2], output.writes);
    }
    return output ?? { status: 1, stdout: '' };
  }
  readFile(path: string): Uint8Array | undefined {
    return this.files.get(path);
  }
  listDir(path: string): string[] | undefined {
    const names = [...this.files.keys()]
      .filter((f) => f.startsWith(`${path}/`))
      .map((f) => f.slice(path.length + 1));
    return names.length > 0 ? names : undefined;
  }
  tempFile(name: string): string {
    return `/tmp/${name}`;
  }
  remove(path: string): void {
    this.files.delete(path);
  }
}

const encodeUtf16 = (text: string): Uint8Array => {
  const bytes = new Uint8Array(text.length * 2);
  for (let i = 0; i < text.length; i += 1) {
    bytes[i * 2] = text.charCodeAt(i) & 0xff;
    bytes[i * 2 + 1] = text.charCodeAt(i) >> 8;
  }
  return bytes;
};

describe('WindowsRegistryPolicyProvider', () => {
  it('exports both hives, decodes UTF-16 and cleans up', () => {
    const io = new FakeIo();
    io.outputs[`reg export HKLM\\${root}`] = {
      status: 0,
      stdout: '',
      writes: encodeUtf16(registryExport),
    };
    const result = new WindowsRegistryPolicyProvider(io, root).load();
    expect(io.commands).toEqual([
      `reg export HKLM\\${root} /tmp/policies-HKLM.reg /y`,
      `reg export HKCU\\${root} /tmp/policies-HKCU.reg /y`,
    ]);
    expect(result.values.find((v) => v.name === 'HomepageLocation')?.value).toContain('ße');
    expect(io.files.size).toBe(0);
  });

  it('reports a missing export file', () => {
    const io = new FakeIo();
    io.outputs['reg export HKLM'] = { status: 0, stdout: '' };
    expect(new WindowsRegistryPolicyProvider(io, root).load().errors).toEqual([
      { source: 'HKLM', message: 'The registry export was not written' },
    ]);
  });
});

describe('MacManagedPreferencesPolicyProvider', () => {
  it('reads machine and user profiles through plutil', () => {
    const io = new FakeIo();
    const machine = '/Library/Managed Preferences/io.github.secoolioo.astela.plist';
    const user = '/Library/Managed Preferences/ana/io.github.secoolioo.astela.plist';
    io.files.set(machine, new Uint8Array([1]));
    io.files.set(user, new Uint8Array([1]));
    io.outputs[`plutil -convert xml1 -o - ${machine}`] = {
      status: 0,
      stdout: '<plist><dict><key>UpdatePolicy</key><integer>0</integer></dict></plist>',
    };
    io.outputs[`plutil -convert xml1 -o - ${user}`] = {
      status: 0,
      stdout: '<plist><array/></plist>',
    };
    const result = new MacManagedPreferencesPolicyProvider(
      io,
      'io.github.secoolioo.astela',
      'ana',
    ).load();
    expect(result.values).toEqual([
      { name: 'UpdatePolicy', value: 0, level: 'mandatory', scope: 'machine', source: machine },
    ]);
    expect(result.errors).toEqual([
      { source: user, message: 'The property list is not a dictionary' },
    ]);
  });

  it('reports plutil failures and malformed output', () => {
    const io = new FakeIo();
    const machine = '/Library/Managed Preferences/b.plist';
    const user = '/Library/Managed Preferences/u/b.plist';
    io.files.set(machine, new Uint8Array([1]));
    io.files.set(user, new Uint8Array([1]));
    io.outputs[`plutil -convert xml1 -o - ${machine}`] = { status: 1, stdout: '' };
    io.outputs[`plutil -convert xml1 -o - ${user}`] = { status: 0, stdout: 'garbage' };
    const errors = new MacManagedPreferencesPolicyProvider(io, 'b', 'u').load().errors;
    expect(errors.map((e) => e.message)).toEqual([
      'plutil could not read the file',
      'PlistError: Missing <plist> element',
    ]);
  });
});

describe('LinuxJsonPolicyProvider', () => {
  it('merges files alphabetically per level and reports invalid files', () => {
    const io = new FakeIo();
    const put = (path: string, text: string): void =>
      void io.files.set(path, new TextEncoder().encode(text));
    put('/etc/astela/policies/managed/20-site.json', '{"UpdatePolicy": 2}');
    put('/etc/astela/policies/managed/10-base.json', '{"UpdatePolicy": 1, "URLBlocklist": ["a"]}');
    put('/etc/astela/policies/managed/30-broken.json', '{');
    put('/etc/astela/policies/managed/40-list.json', '[1]');
    put('/etc/astela/policies/managed/readme.txt', 'ignored');
    put('/etc/astela/policies/recommended/a.json', '{"TabStripPosition": "left"}');
    const result = new LinuxJsonPolicyProvider(io, '/etc/astela/policies').load();
    expect(result.values.map((v) => [v.name, v.value, v.level])).toEqual([
      ['UpdatePolicy', 2, 'mandatory'],
      ['URLBlocklist', ['a'], 'mandatory'],
      ['TabStripPosition', 'left', 'recommended'],
    ]);
    expect(result.errors.map((e) => e.source)).toEqual([
      '/etc/astela/policies/managed/30-broken.json',
      '/etc/astela/policies/managed/40-list.json',
    ]);
  });
});

describe('Node adapters', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('caches policy values in a JSON file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'policy-cache-'));
    dirs.push(dir);
    const cache = new JsonFilePolicyCache(join(dir, 'nested', 'policies.json'));
    expect(cache.read()).toBeUndefined();
    const values = [
      { name: 'A', value: 1, level: 'mandatory', scope: 'machine', source: 's' } as const,
    ];
    cache.write(values);
    expect(cache.read()).toEqual(values);
  });

  it('reads, lists and removes real files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'policy-io-'));
    dirs.push(dir);
    expect(nodePolicyIo.readFile(join(dir, 'missing'))).toBeUndefined();
    expect(nodePolicyIo.listDir(join(dir, 'missing'))).toBeUndefined();
    expect(nodePolicyIo.listDir(dir)).toEqual([]);
    expect(nodePolicyIo.tempFile('x')).toContain(`${process.pid}-x`);
    expect(nodePolicyIo.run(process.execPath, ['-e', 'process.stdout.write("hi")'])).toEqual({
      status: 0,
      stdout: 'hi',
    });
    nodePolicyIo.remove(join(dir, 'missing'));
  });
});
