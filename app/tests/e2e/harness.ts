import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { ShellState } from '../../src/shared/ipc/shell-contracts.ts';

const fixtures = resolve(import.meta.dirname, 'fixtures');

declare global {
  interface Window {
    /** The shell's preload bridge; only internal pages have it. */
    readonly bridge: { invoke(channel: string, payload: unknown): Promise<unknown> };
  }
}

/** A local web server for test pages; tests never load third-party sites. */
export class FixtureServer {
  private server: Server | undefined;
  origin = '';

  /** Starts the server on a random port of 127.0.0.1. */
  async start(): Promise<void> {
    this.server = createServer((request, response) => {
      const name =
        new URL(request.url ?? '/', 'http://x').pathname.replace(/^\//, '') || 'index.html';
      try {
        const body = readFileSync(join(fixtures, name.replace(/[^a-z0-9.-]/gi, '')));
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end(body);
      } catch {
        response.writeHead(404).end();
      }
    });
    await new Promise<void>((done) => this.server?.listen(0, '127.0.0.1', done));
    const address = this.server.address();
    this.origin =
      typeof address === 'object' && address !== null ? `http://127.0.0.1:${address.port}` : '';
  }

  /** Stops the server. */
  async stop(): Promise<void> {
    await new Promise((done) => this.server?.close(done));
  }
}

/** A running browser with its shell page. */
export interface Browser {
  readonly app: ElectronApplication;
  readonly shell: Page;
  readonly profile: string;
  close(): Promise<void>;
}

/**
 * Starts the browser with a fresh profile. `E2E_APP` points to a packaged test build;
 * without it, the development build in `out/` is started with the local Electron.
 */
export async function launch(): Promise<Browser> {
  const profile = mkdtempSync(join(tmpdir(), 'e2e-profile-'));
  const packaged = process.env['E2E_APP'];
  const args = [`--user-data-dir=${profile}`, '--lang=en-US'];
  if (process.platform === 'linux' && process.getuid?.() === 0) {
    args.push('--no-sandbox');
  }
  const app = await electron.launch(
    packaged === undefined
      ? { args: [resolve(import.meta.dirname, '../..'), ...args] }
      : { executablePath: packaged, args },
  );
  const shell = await waitForPage(app, (url) => url.startsWith('app://shell'));
  await shell.waitForSelector('app-shell');
  return {
    app,
    shell,
    profile,
    async close(): Promise<void> {
      // The browser saves its state before it quits, so it answers the quit request only
      // after the process is gone. Wait for the process instead of the answer.
      const child = app.process();
      const exited =
        child.exitCode === null
          ? new Promise<void>((done) => child.once('exit', () => done()))
          : Promise.resolve();
      await app.evaluate(({ app: electronApp }) => {
        setTimeout(() => electronApp.quit(), 0);
      });
      let timer: NodeJS.Timeout | undefined;
      await Promise.race([
        exited,
        new Promise((_, fail) => {
          timer = setTimeout(
            () => fail(new Error('The browser did not exit within 15 seconds')),
            15_000,
          );
        }),
      ]).finally(() => clearTimeout(timer));
      rmSync(profile, { recursive: true, force: true });
    },
  };
}

/**
 * Waits until a page whose URL matches exists.
 * @param app - The browser.
 * @param match - URL test.
 */
export async function waitForPage(
  app: ElectronApplication,
  match: (url: string) => boolean,
): Promise<Page> {
  for (let i = 0; i < 100; i += 1) {
    const page = app.windows().find((p) => match(p.url()));
    if (page !== undefined) {
      return page;
    }
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error('Page not found');
}

/** Reads the shell state through the shell's own bridge. */
export async function shellState(shell: Page): Promise<ShellState> {
  return (await shell.evaluate(() => window.bridge.invoke('shell.getState', {}))) as ShellState;
}

/**
 * Presses a key as a native input event, so the browser's own shortcut handling sees it.
 * @param browser - The running browser.
 * @param keyCode - Electron key code, such as `T`.
 * @param modifiers - Modifier names; `primary` is Cmd on macOS and Ctrl elsewhere.
 */
export async function pressNative(
  browser: Browser,
  keyCode: string,
  modifiers: readonly ('primary' | 'shift' | 'alt')[] = [],
): Promise<void> {
  const mapped = modifiers.map((m) =>
    m === 'primary' ? (process.platform === 'darwin' ? 'meta' : 'control') : m,
  );
  await browser.app.evaluate(
    ({ webContents }, { keyCode: key, mapped: mods }) => {
      const shell = webContents
        .getAllWebContents()
        .find((w) => w.getURL().startsWith('app://shell'));
      shell?.sendInputEvent({ type: 'keyDown', keyCode: key, modifiers: mods });
      shell?.sendInputEvent({ type: 'keyUp', keyCode: key, modifiers: mods });
    },
    { keyCode, mapped },
  );
}
