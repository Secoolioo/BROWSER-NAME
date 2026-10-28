import { chromium, type Browser as CdpBrowser, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type * as Electron from 'electron';
import type { ShellState } from '../../src/shared/ipc/shell-contracts.ts';

const fixtures = resolve(import.meta.dirname, 'fixtures');
const appDir = resolve(import.meta.dirname, '../..');

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

/**
 * The browser's main process, reached through the Node.js inspector. Functions are sent as
 * source text and run with the `electron` module as their first argument.
 */
export class MainProcess {
  private readonly socket: WebSocket;
  private nextId = 1;
  private readonly pending = new Map<number, (message: InspectorMessage) => void>();

  private constructor(socket: WebSocket) {
    this.socket = socket;
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data)) as InspectorMessage;
      if (message.id !== undefined) this.pending.get(message.id)?.(message);
    });
  }

  /** Connects to the inspector of a started browser. */
  static async connect(url: string): Promise<MainProcess> {
    const socket = new WebSocket(url);
    await new Promise<void>((done, fail) => {
      socket.addEventListener('open', () => done(), { once: true });
      socket.addEventListener('error', () => fail(new Error('Inspector connection failed')), {
        once: true,
      });
    });
    return new MainProcess(socket);
  }

  /**
   * Runs a function in the main process and returns its result.
   * @param fn - Function of the `electron` module and the argument.
   * @param arg - A JSON value passed to the function.
   */
  async evaluate<R, A = undefined>(
    fn: (electron: typeof Electron, arg: A) => R | Promise<R>,
    arg?: A,
  ): Promise<R> {
    const id = this.nextId;
    this.nextId += 1;
    const expression = `(async () => (${fn.toString()})(require('electron'), ${JSON.stringify(arg ?? null)}))()`;
    const answer = new Promise<InspectorMessage>((done) => this.pending.set(id, done));
    this.socket.send(
      JSON.stringify({
        id,
        method: 'Runtime.evaluate',
        params: {
          expression,
          includeCommandLineAPI: true,
          awaitPromise: true,
          returnByValue: true,
        },
      }),
    );
    const message = await answer;
    this.pending.delete(id);
    const details = message.result?.exceptionDetails;
    if (details !== undefined) {
      throw new Error(details.exception?.description ?? details.text ?? 'Evaluation failed');
    }
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the value comes from fn
    return message.result?.result?.value as R;
  }

  /** Disconnects, so the process can exit without waiting for the debugger. */
  close(): void {
    this.socket.close();
  }
}

interface InspectorMessage {
  readonly id?: number;
  readonly result?: {
    readonly result?: { readonly value?: unknown };
    readonly exceptionDetails?: {
      readonly text?: string;
      readonly exception?: { readonly description?: string };
    };
  };
}

/** A running browser with its shell page. */
export interface Browser {
  readonly main: MainProcess;
  readonly cdp: CdpBrowser;
  readonly shell: Page;
  readonly process: ChildProcess;
  readonly profile: string;
  close(): Promise<void>;
}

/** Waits until the process prints a line that matches, and returns the match. */
function waitForLine(child: ChildProcess, pattern: RegExp): Promise<RegExpExecArray> {
  return new Promise((done, fail) => {
    let buffer = '';
    const onData = (chunk: Buffer): void => {
      buffer += chunk.toString();
      const match = pattern.exec(buffer);
      if (match !== null) {
        child.stderr?.off('data', onData);
        done(match);
      }
    };
    child.stderr?.on('data', onData);
    child.once('exit', (code) => fail(new Error(`The browser exited with ${String(code)}`)));
  });
}

/**
 * Starts the browser with a fresh profile and connects once its shell has rendered, which
 * the self-test report announces. `E2E_APP` points to a packaged test build; without it,
 * the development build in `out/` is started with the local Electron.
 */
export async function launch(): Promise<Browser> {
  const profile = mkdtempSync(join(tmpdir(), 'e2e-profile-'));
  const report = join(profile, 'ready.json');
  const args = [
    '--inspect=0',
    '--remote-debugging-port=0',
    `--user-data-dir=${join(profile, 'data')}`,
    '--lang=en-US',
    `--smoke-test=${report}`,
    '--smoke-test-keep-running',
  ];
  if (process.platform === 'linux' && process.getuid?.() === 0) args.push('--no-sandbox');
  const packaged = process.env['E2E_APP'];
  const electronPath = createRequire(join(appDir, 'package.json'))('electron') as string;
  const child =
    packaged === undefined
      ? spawn(electronPath, [appDir, ...args], { stdio: ['ignore', 'inherit', 'pipe'] })
      : spawn(packaged, args, { stdio: ['ignore', 'inherit', 'pipe'] });
  child.stderr?.on('data', (chunk: Buffer) => process.stderr.write(chunk));
  const inspector = waitForLine(child, /Debugger listening on (ws:\/\/\S+)/);
  const devtools = waitForLine(child, /DevTools listening on (ws:\/\/\S+)/);
  const [inspectorMatch, devtoolsMatch] = await Promise.all([inspector, devtools]);
  for (let i = 0; !existsSync(report); i += 1) {
    if (i > 300 || child.exitCode !== null) throw new Error('The shell did not become ready');
    await new Promise((done) => setTimeout(done, 100));
  }
  const main = await MainProcess.connect(inspectorMatch[1] ?? '');
  const cdp = await chromium.connectOverCDP(devtoolsMatch[1] ?? '');
  const shell = await waitForPage({ cdp }, (url) => url.startsWith('app://shell'));
  await shell.waitForSelector('app-shell');
  return {
    main,
    cdp,
    shell,
    process: child,
    profile,
    async close(): Promise<void> {
      // The browser saves its state before it quits, so wait for the process to exit.
      const exited =
        child.exitCode === null
          ? new Promise<void>((done) => child.once('exit', () => done()))
          : Promise.resolve();
      await main.evaluate(({ app }) => {
        setTimeout(() => app.quit(), 0);
      });
      main.close();
      await cdp.close().catch(() => undefined);
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
 * @param browser - The connected browser.
 * @param match - URL test.
 */
export async function waitForPage(
  browser: Pick<Browser, 'cdp'>,
  match: (url: string) => boolean,
): Promise<Page> {
  for (let i = 0; i < 100; i += 1) {
    const page = browser.cdp
      .contexts()
      .flatMap((context) => context.pages())
      .find((p) => match(p.url()));
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
  await browser.main.evaluate(
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
