import { app, Menu, session, type Session } from 'electron';
import { join } from 'node:path';
import { brand } from '../shared/brand.ts';
import {
  ActivateTab,
  CloseTab,
  GetShellState,
  NavigateTab,
  OpenTab,
  ReopenClosedTab,
  SetShellInsets,
  TabAction,
} from '../shared/ipc/shell-contracts.ts';
import { Lifecycle } from '../kernel/lifecycle/lifecycle.ts';
import {
  FanOutLogSink,
  RingBufferLogSink,
  SinkLogger,
  type Logger,
} from '../kernel/logging/logger.ts';
import { resolveOmniboxInput } from '../domain/navigation/omnibox.ts';
import { PolicyService } from '../domain/policy/policy-service.ts';
import { SettingsService, settingPolicies } from '../domain/settings/settings-service.ts';
import { updatePolicies } from '../domain/updates/update-policies.ts';
import { AppProtocol, registerAppScheme } from '../platform/electron/app-protocol.ts';
import {
  WindowManager,
  type BrowserWindowController,
} from '../platform/electron/browser-window.ts';
import { IpcGate } from '../platform/electron/ipc-gate.ts';
import { IpcRouter } from '../platform/electron/ipc-router.ts';
import {
  cleanUserAgent,
  guardWebContents,
  hardenSession,
} from '../platform/electron/session-security.ts';
import { RotatingFileLogSink } from '../platform/node/file-log-sink.ts';
import { JsonFileSettingsStore } from '../platform/node/json-settings-store.ts';
import { SystemClock } from '../platform/node/system-clock.ts';
import { JsonFilePolicyCache } from '../platform/policy/policy-providers.ts';
import { createPolicyProviders } from '../platform/policy/platform-providers.ts';
import { SearchUrlTemplate, coreSettings } from './core-settings.ts';
import { showSandboxHelp } from './sandbox-help.ts';
import { checkBoot } from './boot.ts';
import { windowBackground } from './window-background.ts';
import { runSandboxHelpSmokeTest, runSmokeTest } from './smoke-test.ts';
import type { UpdateService } from '../domain/updates/update-service.ts';

/** Paths of the bundled files, relative to the main bundle. */
export interface BundleLayout {
  /** Directory of the renderer build (one folder per internal host). */
  readonly rendererDir: string;
  /** Preload script of the shell. */
  readonly shellPreload: string;
  /** Preload script of internal pages. */
  readonly pagePreload: string;
  /** Dev server URL of the shell, only during development. */
  readonly devShellUrl: string | undefined;
}

const internalPartition = 'internal';
const webPartition = 'persist:default';
const blankUrl = 'about:blank';

/**
 * Starts the browser. The order matters for start-up time and safety: schemes and
 * policies before `ready`, sessions hardened before any view exists, the window as early
 * as possible, everything else after the first paint.
 * @param layout - Where the bundled files are.
 */
export async function bootstrap(layout: BundleLayout): Promise<void> {
  // Milliseconds since process start at each step, for the self-test report.
  const marks: Record<string, number> = { main: Math.round(performance.now()) };
  // Wall-clock time at which these milliseconds start, to add the shell page's own timing.
  const timeOrigin = Date.now() - performance.now();
  registerAppScheme();
  app.setName(brand.productName);
  app.userAgentFallback = cleanUserAgent(app.userAgentFallback);
  const safeMode = app.commandLine.hasSwitch('safe-mode');
  const clock = new SystemClock();
  const userData = app.getPath('userData');
  const recentLogs = new RingBufferLogSink(500);
  const logger: Logger = new SinkLogger(
    new FanOutLogSink([
      new RotatingFileLogSink({ directory: join(userData, 'logs'), name: 'main' }),
      recentLogs,
    ]),
    clock,
    { scope: 'main', level: app.isPackaged ? 'info' : 'debug' },
  );
  logger.info('Starting', {
    version: app.getVersion(),
    electron: process.versions.electron,
    safeMode,
  });

  // Policies are read synchronously before ready, because some become Chromium switches.
  const policies = new PolicyService(
    [...settingPolicies(coreSettings), ...updatePolicies],
    createPolicyProviders(brand, process.platform),
    logger,
    new JsonFilePolicyCache(join(userData, 'policy-cache.json')),
  );
  policies.refresh();
  marks['policies'] = Math.round(performance.now());

  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }
  // After the lock, so a second start of a running browser is not counted as a start.
  const boot = checkBoot(logger);
  if (boot === undefined) {
    app.exit(0);
    return;
  }
  Menu.setApplicationMenu(process.platform === 'darwin' ? Menu.buildFromTemplate(macMenu()) : null);

  await app.whenReady();
  marks['ready'] = Math.round(performance.now());
  const lifecycle = new Lifecycle(logger, clock, {});
  const protocolHandler = new AppProtocol(layout.rendererDir, new Set(['shell', 'sandbox-help']));
  const internal = session.fromPartition(internalPartition);
  protocolHandler.serve(internal);
  hardenSession(internal);
  const webSessions = new Set<Session>();
  const protectWebSession = (s: Session): void => {
    if (s !== internal && !webSessions.has(s)) {
      webSessions.add(s);
      protocolHandler.refuse(s);
      hardenSession(s);
    }
  };
  app.on('session-created', protectWebSession);
  protectWebSession(session.defaultSession);
  protectWebSession(session.fromPartition(webPartition));

  const gate = new IpcGate(clock);
  const router = new IpcRouter(gate, logger);
  if (app.commandLine.hasSwitch('sandbox-help')) {
    // Started by the AppImage launcher because the sandbox cannot work: no web content.
    const help = showSandboxHelp({
      url: 'app://sandbox-help/',
      origin: 'app://sandbox-help',
      preload: layout.pagePreload,
      partition: internalPartition,
      gate,
      router,
      logger,
    });
    app.on('window-all-closed', () => app.quit());
    const helpReport = app.commandLine.getSwitchValue('smoke-test');
    if (helpReport !== '') {
      runSandboxHelpSmokeTest(help.webContents, helpReport);
    }
    return;
  }
  const store = new JsonFileSettingsStore(
    join(userData, 'settings.json'),
    join(userData, 'settings.rejected.json'),
    clock,
  );
  const settings = new SettingsService(coreSettings, policies, store, logger);
  // The first window does not need user settings to appear, so they load alongside it.
  const settingsLoaded = settings
    .load()
    .catch((error: unknown) => logger.error('Settings could not be loaded; defaults apply', error))
    .then(() => {
      marks['settings'] = Math.round(performance.now());
    });

  const windows = new WindowManager({
    shellUrl: layout.devShellUrl ?? 'app://shell/',
    shellOrigin:
      layout.devShellUrl === undefined ? 'app://shell' : new URL(layout.devShellUrl).origin,
    shellPreload: layout.shellPreload,
    internalPartition,
    webPartition,
    blankUrl,
    backgroundColor: windowBackground(),
    gate,
    router,
    logger,
  });
  guardWebContents(app, {
    isInternal: (contents) => windows.isShell(contents),
    openInTab: (url, opener) => windows.forTab(opener)?.tabs.open(url),
    logger,
  });
  registerShellHandlers(router, windows, settings, settingsLoaded);

  const first = windows.open();
  marks['window'] = Math.round(performance.now());
  lifecycle.advance('ready');
  // A start counts as healthy after 10 s with a loaded shell, or when it quits normally.
  let shellLoaded = false;
  first.shellContents.once('did-finish-load', () => {
    shellLoaded = true;
    setTimeout(() => boot.guard.markHealthy(app.getVersion()), 10_000).unref();
  });
  const smokeReport = app.commandLine.getSwitchValue('smoke-test');
  if (smokeReport !== '') {
    runSmokeTest(first, smokeReport, {
      keepRunning: app.commandLine.hasSwitch('smoke-test-keep-running'),
      marks,
      timeOrigin,
    });
  }
  logger.info('First window opened', { ms: Math.round(process.uptime() * 1000) });

  // Everything that is not needed for the first window loads after its shell.
  let updates: UpdateService | undefined;
  first.shellContents.once('did-finish-load', () => {
    void import('./updates.ts')
      .then(({ createUpdateService }) => {
        updates = createUpdateService({ policies, clock, logger, userData, boot });
        updates.start();
      })
      .catch((error: unknown) => logger.error('The update service failed to start', error));
  });

  const refreshPolicies = (): void => void policies.refresh();
  app.on('browser-window-focus', refreshPolicies);
  const timer = setInterval(refreshPolicies, 15 * 60 * 1000);
  timer.unref();

  app.on('second-instance', () => windows.all[0]?.window.focus() ?? windows.open());
  app.on('activate', () => {
    if (windows.all.length === 0) windows.open();
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
  let quitting = false;
  app.on('before-quit', (event) => {
    if (quitting) return;
    quitting = true;
    event.preventDefault();
    logger.info('Shutting down');
    if (shellLoaded) boot.guard.markHealthy(app.getVersion());
    lifecycle.onWillShutdown((e) => {
      e.join(store.flush(), 'settings');
      const web = session.fromPartition(webPartition);
      web.flushStorageData();
      e.join(web.cookies.flushStore(), 'cookies');
    });
    void lifecycle.shutdown('quit').then(() => {
      windows.dispose();
      updates?.installOnExit();
      updates?.dispose();
      logger.info('Shutdown complete');
      // Everything is saved and every window is closed at this point.
      app.exit(0);
    });
  });
  lifecycle.advance('running');
}

function registerShellHandlers(
  router: IpcRouter,
  windows: WindowManager,
  settings: SettingsService,
  settingsLoaded: Promise<void>,
): void {
  const windowOf = (sender: Electron.WebContents): BrowserWindowController => {
    const window = windows.forShell(sender);
    if (window === undefined) {
      throw new Error('No window for this shell');
    }
    return window;
  };
  const target = async (input: string): Promise<string | undefined> => {
    await settingsLoaded;
    return resolveOmniboxInput(input, settings.get(SearchUrlTemplate))?.url;
  };
  router.handle(GetShellState, (_request, { sender }) => windowOf(sender).state());
  router.handle(OpenTab, async ({ input }, { sender }) => {
    const url = input === undefined ? undefined : await target(input);
    return { tabId: windowOf(sender).tabs.open(url) };
  });
  router.handle(
    ActivateTab,
    ({ tabId }, { sender }) => (windowOf(sender).tabs.activate(tabId), null),
  );
  router.handle(CloseTab, ({ tabId }, { sender }) => (windowOf(sender).tabs.close(tabId), null));
  router.handle(
    ReopenClosedTab,
    (_request, { sender }) => (windowOf(sender).tabs.reopenClosed(), null),
  );
  router.handle(NavigateTab, async ({ tabId, input }, { sender }) => {
    const url = await target(input);
    if (url !== undefined) windowOf(sender).tabs.navigate(tabId, url);
    return null;
  });
  router.handle(
    TabAction,
    ({ tabId, action }, { sender }) => (windowOf(sender).tabs.run(tabId, action), null),
  );
  router.handle(SetShellInsets, (insets, { sender }) => (windowOf(sender).setInsets(insets), null));
}

function macMenu(): Electron.MenuItemConstructorOptions[] {
  return [{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' }];
}
