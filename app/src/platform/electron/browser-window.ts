import {
  BaseWindow,
  WebContentsView,
  type ContextMenuParams,
  type Input,
  type Rectangle,
  type WebContents,
} from 'electron';
import { DisposableStore, toDisposable, type Disposable } from '../../shared/disposable.ts';
import {
  ShellCommand,
  ShellStateChanged,
  type ShellState,
} from '../../shared/ipc/shell-contracts.ts';
import type { Logger } from '../../kernel/logging/logger.ts';
import { TabService, type TabId, type TabViewPort } from '../../domain/tabs/tab-service.ts';
import type { IpcGate } from './ipc-gate.ts';
import type { IpcRouter } from './ipc-router.ts';
import { commandForInput, type WindowCommand } from './shortcuts.ts';

/** Space the shell occupies at the window edges. */
export interface Insets {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

/** A view's request for its context menu, with what the menu needs to know about the view. */
export interface ContextMenuRequest {
  /** The window that shows the view. */
  readonly window: BrowserWindowController;
  /** The tab whose page was clicked; `undefined` for the shell. */
  readonly tabId: TabId | undefined;
  /** The view's web contents. */
  readonly contents: WebContents;
  /** What was clicked, as Chromium reports it. */
  readonly params: ContextMenuParams;
  /** Where the view is in the window, for menus opened with the keyboard. */
  readonly bounds: Rectangle;
}

/** Everything a window needs from its environment. */
export interface BrowserWindowOptions {
  /** URL of the shell page, normally `app://shell/`. */
  readonly shellUrl: string;
  /** Origin the shell page must have. */
  readonly shellOrigin: string;
  /** Path of the shell's preload script. */
  readonly shellPreload: string;
  /** Partition of the browser's own views. */
  readonly internalPartition: string;
  /** Partition of web tabs. */
  readonly webPartition: string;
  /** URL of a new, empty tab. */
  readonly blankUrl: string;
  /** Window background while the shell loads. */
  readonly backgroundColor: string;
  readonly gate: IpcGate;
  readonly router: IpcRouter;
  readonly logger: Logger;
  /** Shows the context menu of a view; without it, views have none. */
  readonly onContextMenu?: (request: ContextMenuRequest) => void;
}

/**
 * One browser window: a `BaseWindow` with the shell view and one `WebContentsView` per
 * tab. Tab views are created when a tab opens and destroyed when it closes; only the
 * active tab's view is attached to the window.
 */
export class BrowserWindowController implements Disposable, TabViewPort {
  readonly window: BaseWindow;
  readonly shell: WebContentsView;
  readonly tabs: TabService;
  private readonly views = new Map<TabId, WebContentsView>();
  private visible: WebContentsView | undefined;
  private insets: Insets = { top: 76, right: 0, bottom: 0, left: 0 };
  private readonly subscriptions = new DisposableStore();
  private publishTimer: NodeJS.Timeout | undefined;
  private readonly options: BrowserWindowOptions;

  /** @param options - Environment of the window. */
  constructor(options: BrowserWindowOptions) {
    this.options = options;
    this.window = new BaseWindow({
      width: 1280,
      height: 820,
      minWidth: 480,
      minHeight: 320,
      show: false,
      backgroundColor: options.backgroundColor,
    });
    this.shell = new WebContentsView({
      webPreferences: {
        preload: options.shellPreload,
        partition: options.internalPartition,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        spellcheck: false,
        v8CacheOptions: 'bypassHeatCheck',
      },
    });
    this.shell.setBackgroundColor(options.backgroundColor);
    this.window.contentView.addChildView(this.shell);
    this.subscriptions.add(
      options.gate.registerView(this.shell.webContents.id, {
        origin: options.shellOrigin,
        capabilities: new Set(['shell']),
      }),
    );
    this.tabs = new TabService(this, options.blankUrl);
    this.subscriptions.add(this.tabs.onDidChange(() => this.schedulePublish()));
    this.subscriptions.add(this.tabs);
    this.shell.webContents.on('before-input-event', (event, input) => this.intercept(event, input));
    this.forwardContextMenu(this.shell, undefined);
    this.shell.webContents.once('did-finish-load', () => {
      this.layout();
      this.window.show();
    });
    this.window.on('resize', () => this.layout());
    this.window.on('closed', () => this.dispose());
    void this.shell.webContents.loadURL(options.shellUrl);
    this.layout();
  }

  /** The shell's `WebContents`. */
  get shellContents(): WebContents {
    return this.shell.webContents;
  }

  /** The current shell state, as sent to the shell. */
  state(): ShellState {
    return {
      tabs: this.tabs.all.map(({ id, title, url, loading, canGoBack, canGoForward }) => ({
        id,
        title,
        url,
        loading,
        canGoBack,
        canGoForward,
      })),
      activeTabId: this.tabs.active?.id ?? null,
    };
  }

  /**
   * Updates the space the shell occupies.
   * @param insets - New insets in CSS pixels.
   */
  setInsets(insets: Insets): void {
    this.insets = insets;
    this.layout();
  }

  /** Tells whether a `WebContents` is one of this window's tab views. */
  ownsTab(contents: WebContents): boolean {
    return [...this.views.values()].some((view) => view.webContents === contents);
  }

  create(id: TabId, url: string): void {
    const view = new WebContentsView({
      webPreferences: {
        partition: this.options.webPartition,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        spellcheck: false,
      },
    });
    const contents = view.webContents;
    const sync = (): void => {
      if (contents.isDestroyed()) {
        return;
      }
      this.tabs.update(id, {
        url: contents.getURL() || url,
        title: contents.getTitle(),
        loading: contents.isLoading(),
        canGoBack: contents.navigationHistory.canGoBack(),
        canGoForward: contents.navigationHistory.canGoForward(),
      });
    };
    contents.on('did-start-loading', sync);
    contents.on('did-stop-loading', sync);
    contents.on('did-navigate', sync);
    contents.on('did-navigate-in-page', sync);
    contents.on('page-title-updated', sync);
    contents.on('before-input-event', (event, input) => this.intercept(event, input));
    this.forwardContextMenu(view, id);
    this.views.set(id, view);
    this.loadInto(contents, url);
  }

  show(id: TabId): void {
    const view = this.views.get(id);
    if (view === undefined || view === this.visible) {
      return;
    }
    if (this.visible !== undefined) {
      this.window.contentView.removeChildView(this.visible);
    }
    this.visible = view;
    this.window.contentView.addChildView(view);
    this.layout();
    if (view.webContents.getURL() !== this.options.blankUrl) {
      view.webContents.focus();
    }
  }

  destroy(id: TabId): void {
    const view = this.views.get(id);
    if (view === undefined) {
      return;
    }
    this.views.delete(id);
    if (this.visible === view) {
      // A destroyed window no longer has a content view; touching it blocks.
      if (!this.window.isDestroyed()) {
        this.window.contentView.removeChildView(view);
      }
      this.visible = undefined;
    }
    view.webContents.close();
  }

  load(id: TabId, url: string): void {
    const view = this.views.get(id);
    if (view !== undefined) {
      this.loadInto(view.webContents, url);
      view.webContents.focus();
    }
  }

  run(id: TabId, action: 'back' | 'forward' | 'reload' | 'stop'): void {
    const contents = this.views.get(id)?.webContents;
    const history = contents?.navigationHistory;
    if (action === 'back' && history?.canGoBack() === true) history.goBack();
    if (action === 'forward' && history?.canGoForward() === true) history.goForward();
    if (action === 'reload') contents?.reload();
    if (action === 'stop') contents?.stop();
  }

  /** Closes the window and every tab view. */
  dispose(): void {
    // A message to a shell that is closing can block the exit of the app.
    clearTimeout(this.publishTimer);
    this.subscriptions.dispose();
    if (!this.window.isDestroyed()) {
      this.window.destroy();
    }
    if (!this.shell.webContents.isDestroyed()) {
      this.shell.webContents.close();
    }
  }

  /**
   * Runs a window command, such as opening a tab.
   * @param command - The command.
   */
  execute(command: WindowCommand): void {
    const active = this.tabs.active;
    const all = this.tabs.all;
    const index = active === undefined ? -1 : all.indexOf(active);
    switch (command) {
      case 'tab.new':
        this.tabs.open();
        this.shell.webContents.focus();
        this.options.router.publish(ShellCommand, this.shell.webContents, 'omnibox.focus');
        break;
      case 'tab.close':
        if (active !== undefined) this.tabs.close(active.id);
        break;
      case 'tab.reopen':
        this.tabs.reopenClosed();
        break;
      case 'tab.next':
      case 'tab.previous': {
        const step = command === 'tab.next' ? 1 : -1;
        const next = all[(index + step + all.length) % all.length];
        if (next !== undefined) this.tabs.activate(next.id);
        break;
      }
      case 'page.reload':
      case 'page.back':
      case 'page.forward':
        if (active !== undefined) {
          const action =
            command === 'page.reload' ? 'reload' : command === 'page.back' ? 'back' : 'forward';
          this.tabs.run(active.id, action);
        }
        break;
      case 'omnibox.focus':
        this.shell.webContents.focus();
        this.options.router.publish(ShellCommand, this.shell.webContents, 'omnibox.focus');
        break;
    }
  }

  /**
   * Runs the shortcut of a key press in the shell or in a tab before the view sees the key.
   * The mouse's back and forward buttons need nothing here: Chromium navigates the page
   * under the pointer itself, and the shell passes them on to the active tab. The window's
   * `app-command` event reports them as well and stays unused, or one click would go back
   * two pages.
   */
  private intercept(event: { preventDefault(): void }, input: Input): void {
    const command = commandForInput(input, process.platform);
    if (command !== undefined) {
      event.preventDefault();
      this.execute(command);
    }
  }

  private forwardContextMenu(view: WebContentsView, tabId: TabId | undefined): void {
    const contents = view.webContents;
    contents.on('context-menu', (_event, params) => {
      this.options.onContextMenu?.({
        window: this,
        tabId,
        contents,
        params,
        bounds: view.getBounds(),
      });
    });
  }

  private loadInto(contents: WebContents, url: string): void {
    contents.loadURL(url).catch((error: unknown) => {
      // Aborted loads (a new navigation started) are normal.
      if (!String(error).includes('ERR_ABORTED')) {
        this.options.logger.debug('Page load failed', { error: String(error) });
      }
    });
  }

  private layout(): void {
    if (this.window.isDestroyed()) {
      return;
    }
    const { width, height } = this.window.getContentBounds();
    this.shell.setBounds({ x: 0, y: 0, width, height });
    const { top, right, bottom, left } = this.insets;
    this.visible?.setBounds({
      x: left,
      y: top,
      width: Math.max(0, width - left - right),
      height: Math.max(0, height - top - bottom),
    });
  }

  private schedulePublish(): void {
    // Coalesce bursts of tab events into one message per frame.
    this.publishTimer ??= setTimeout(() => {
      this.publishTimer = undefined;
      this.options.router.publish(ShellStateChanged, this.shell.webContents, this.state());
    }, 16);
  }
}

/** Keeps track of open windows and routes shell requests to the right one. */
export class WindowManager implements Disposable {
  private readonly windows = new Set<BrowserWindowController>();
  private readonly options: BrowserWindowOptions;

  /** @param options - Environment for new windows. */
  constructor(options: BrowserWindowOptions) {
    this.options = options;
  }

  /** Opens a window with one tab. */
  open(url?: string): BrowserWindowController {
    const controller = new BrowserWindowController(this.options);
    this.windows.add(controller);
    controller.window.on('closed', () => this.windows.delete(controller));
    controller.tabs.open(url);
    return controller;
  }

  /**
   * Finds the window whose shell sent a request.
   * @param sender - The sending `WebContents`.
   */
  forShell(sender: WebContents): BrowserWindowController | undefined {
    return [...this.windows].find((w) => w.shellContents === sender);
  }

  /**
   * Finds the window that shows a tab view.
   * @param contents - A tab's `WebContents`.
   */
  forTab(contents: WebContents): BrowserWindowController | undefined {
    return [...this.windows].find((w) => w.ownsTab(contents));
  }

  /** Tells whether a `WebContents` is a shell of any window. */
  isShell(contents: WebContents): boolean {
    return this.forShell(contents) !== undefined;
  }

  /** All open windows. */
  get all(): readonly BrowserWindowController[] {
    return [...this.windows];
  }

  /** Closes every window. */
  dispose(): void {
    for (const window of this.windows) {
      window.dispose();
    }
    this.windows.clear();
  }

  /** Returns a disposable that closes all windows. */
  toDisposable(): Disposable {
    return toDisposable(() => this.dispose());
  }
}
