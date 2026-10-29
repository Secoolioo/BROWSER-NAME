import { join } from 'node:path';
import * as v from 'valibot';
import { describe, expect, it } from 'vitest';
import { defineEvent, defineRequest } from '../../shared/ipc/contract.ts';
import { shellChannels, shellEventChannels } from '../../shared/ipc/shell-channels.ts';
import {
  ShellCommand,
  ShellStateChanged,
  shellRequests,
} from '../../shared/ipc/shell-contracts.ts';
import { ManualClock } from '../../kernel/time/clock.ts';
import {
  appContentSecurityPolicy,
  appResponseHeaders,
  appSourceRoutes,
} from '../electron/app-protocol-routes.ts';
import { IpcGate, originOf } from '../electron/ipc-gate.ts';
import { cleanUserAgent } from '../electron/session-security.ts';

const Ping = defineRequest({
  channel: 'test.ping',
  request: v.strictObject({ n: v.number() }),
  response: v.null(),
  capability: 'shell',
  ratePerSecond: 2,
});
const shellSender = { viewId: 7, frameUrl: 'app://shell/index.html', isMainFrame: true };

describe('IpcGate', () => {
  it('accepts valid requests from registered views', () => {
    const gate = new IpcGate(new ManualClock());
    gate.registerView(7, { origin: 'app://shell', capabilities: new Set(['shell']) });
    expect(gate.check(Ping, shellSender, { n: 1 })).toEqual({ ok: true, value: { n: 1 } });
    expect(gate.mayReceive(7, 'shell')).toBe(true);
    expect(gate.mayReceive(8, 'shell')).toBe(false);
  });

  it('refuses unknown senders, subframes, other origins, missing capabilities and bad payloads', () => {
    const gate = new IpcGate(new ManualClock());
    gate.registerView(7, { origin: 'app://shell', capabilities: new Set(['page:settings']) });
    gate.registerView(9, { origin: 'app://shell', capabilities: new Set(['shell']) });
    expect(gate.check(Ping, { ...shellSender, viewId: 1 }, { n: 1 })).toEqual({
      ok: false,
      error: 'unknown-sender',
    });
    expect(gate.check(Ping, { ...shellSender, viewId: 9, isMainFrame: false }, { n: 1 })).toEqual({
      ok: false,
      error: 'not-main-frame',
    });
    expect(
      gate.check(Ping, { ...shellSender, viewId: 9, frameUrl: 'https://evil.example/' }, { n: 1 }),
    ).toEqual({ ok: false, error: 'wrong-origin' });
    expect(gate.check(Ping, shellSender, { n: 1 })).toEqual({
      ok: false,
      error: 'missing-capability',
    });
    expect(gate.check(Ping, { ...shellSender, viewId: 9 }, { n: 'x' })).toEqual({
      ok: false,
      error: 'invalid-payload',
    });
    expect(gate.check(Ping, { ...shellSender, viewId: 9 }, { n: 1, extra: true })).toEqual({
      ok: false,
      error: 'invalid-payload',
    });
  });

  it('rate-limits per sender and channel and refills over time', () => {
    const clock = new ManualClock();
    const gate = new IpcGate(clock);
    gate.registerView(7, { origin: 'app://shell', capabilities: new Set(['shell']) });
    const call = (): string => (gate.check(Ping, shellSender, { n: 1 }).ok ? 'ok' : 'limited');
    expect([call(), call(), call()]).toEqual(['ok', 'ok', 'limited']);
    clock.advance(500);
    expect(call()).toBe('ok');
    expect(call()).toBe('limited');
  });

  it('forgets a view when it is unregistered, but not a newer registration', () => {
    const gate = new IpcGate(new ManualClock());
    const first = gate.registerView(7, { origin: 'app://shell', capabilities: new Set(['shell']) });
    first.dispose();
    expect(gate.check(Ping, shellSender, { n: 1 }).ok).toBe(false);
    const second = gate.registerView(7, {
      origin: 'app://shell',
      capabilities: new Set(['shell']),
    });
    first.dispose();
    expect(gate.check(Ping, shellSender, { n: 1 }).ok).toBe(true);
    second.dispose();
  });

  it('computes origins of internal and web URLs', () => {
    expect(originOf('APP://Shell/index.html?x#y')).toBe('app://shell');
    expect(originOf('https://example.com:8443/a')).toBe('https://example.com:8443');
    expect(originOf('about:blank')).toBe('');
  });
});

describe('contracts', () => {
  it('keeps the preload channel list in sync with the contracts', () => {
    expect(shellRequests.map((c) => c.channel).toSorted()).toEqual([...shellChannels].toSorted());
    expect([ShellStateChanged.channel, ShellCommand.channel].toSorted()).toEqual(
      [...shellEventChannels].toSorted(),
    );
  });

  it('rejects invalid channel names', () => {
    expect(() => defineEvent({ channel: 'Bad', payload: v.null(), capability: 'shell' })).toThrow(
      /dotted camelCase/,
    );
  });
});

describe('appSourceRoutes', () => {
  it('serves each host from its folder and the shared assets folder, with the headers', () => {
    const routes = appSourceRoutes(join('/r'), ['shell', 'settings']);
    expect(routes.map((r) => [r.match.host, r.match.path ?? '/', r.source.root])).toEqual([
      ['shell', '/assets/', join('/r', 'assets')],
      ['shell', '/', join('/r', 'shell')],
      ['settings', '/assets/', join('/r', 'assets')],
      ['settings', '/', join('/r', 'settings')],
    ]);
    expect(routes.every((r) => r.source.type === 'directory')).toBe(true);
    expect(routes[0]?.source.index).toBe('');
    expect(routes[1]?.source.headers).toEqual(appResponseHeaders);
    expect(appResponseHeaders['x-content-type-options']).toBe('nosniff');
  });

  it('serves pages with a strict content security policy', () => {
    expect(appContentSecurityPolicy).toContain("default-src 'none'");
    expect(appContentSecurityPolicy).toContain("require-trusted-types-for 'script'");
    expect(appContentSecurityPolicy).not.toContain('unsafe');
  });
});

describe('cleanUserAgent', () => {
  it('removes the app and Electron tokens', () => {
    const ua =
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) app/0.1.0 Chrome/156.0.8078.48 Electron/45.0.0 Safari/537.36';
    expect(cleanUserAgent(ua)).toBe(
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.8078.48 Safari/537.36',
    );
  });
});
