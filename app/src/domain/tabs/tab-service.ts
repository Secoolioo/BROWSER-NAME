import type { Disposable } from '../../shared/disposable.ts';
import { token, type Token } from '../../kernel/di/token.ts';
import { Emitter, type Event } from '../../kernel/events/emitter.ts';

/** Identifier of a tab, such as `t1a`. */
export type TabId = string;

/** The state of one tab. */
export interface Tab {
  readonly id: TabId;
  readonly url: string;
  readonly title: string;
  readonly loading: boolean;
  readonly canGoBack: boolean;
  readonly canGoForward: boolean;
}

/** Fields of a tab that the web view reports. */
export type TabUpdate = Partial<Omit<Tab, 'id'>>;

/**
 * Port to the web views of a window. The platform layer implements it with one
 * `WebContentsView` per tab; tests use a fake.
 */
export interface TabViewPort {
  /** Creates the view of a tab and loads the URL. */
  create(id: TabId, url: string): void;
  /** Shows the view of a tab and hides the previously shown one. */
  show(id: TabId): void;
  /** Destroys the view of a tab. */
  destroy(id: TabId): void;
  /** Loads a URL in a tab. */
  load(id: TabId, url: string): void;
  /** Runs a history or loading action. */
  run(id: TabId, action: 'back' | 'forward' | 'reload' | 'stop'): void;
}

/** Options for {@link TabService.open}. */
export interface OpenTabOptions {
  /** Whether the new tab becomes the active tab. Defaults to `true`. */
  readonly activate?: boolean;
}

/** Token for the {@link TabService} of a window. */
export const TabServiceToken: Token<TabService> = token<TabService>('TabService');

/** Fields that {@link TabService.update} compares. */
const tabFields = ['url', 'title', 'loading', 'canGoBack', 'canGoForward'] as const;

/** How many closed tabs can be reopened. */
const closedTabLimit = 25;

/**
 * Owns the tabs of one window: their order, the active tab and recently closed tabs. A
 * window always keeps at least one tab.
 */
export class TabService implements Disposable {
  private readonly tabs: Tab[] = [];
  private activeId: TabId | undefined;
  private readonly closed: string[] = [];
  private nextId = 1;
  private readonly changeEmitter = new Emitter<void>();
  private readonly views: TabViewPort;
  private readonly blankUrl: string;

  /** Fires after any tab or the active tab changed. */
  readonly onDidChange: Event<void> = this.changeEmitter.event;

  /**
   * @param views - Creates and controls the web views.
   * @param blankUrl - URL of a new, empty tab.
   */
  constructor(views: TabViewPort, blankUrl: string) {
    this.views = views;
    this.blankUrl = blankUrl;
  }

  /** All tabs in display order. */
  get all(): readonly Tab[] {
    return this.tabs;
  }

  /** The active tab, if any. */
  get active(): Tab | undefined {
    return this.tabs.find((t) => t.id === this.activeId);
  }

  /**
   * Opens a tab after the active one.
   * @param url - URL to load; defaults to the blank page.
   * @param options - Whether to activate the tab.
   * @returns The new tab's id.
   */
  open(url: string = this.blankUrl, options: OpenTabOptions = {}): TabId {
    const id = `t${(this.nextId++).toString(36)}`;
    const tab: Tab = { id, url, title: '', loading: true, canGoBack: false, canGoForward: false };
    const index = this.activeId === undefined ? this.tabs.length : this.indexOf(this.activeId) + 1;
    this.tabs.splice(index, 0, tab);
    this.views.create(id, url);
    if (options.activate ?? true) {
      this.activate(id);
    } else {
      this.changeEmitter.fire();
    }
    return id;
  }

  /**
   * Makes a tab the active tab.
   * @param id - The tab.
   */
  activate(id: TabId): void {
    this.require(id);
    if (this.activeId !== id) {
      this.activeId = id;
      this.views.show(id);
    }
    this.changeEmitter.fire();
  }

  /**
   * Closes a tab. Closing the active tab activates its right neighbour, or the left one
   * at the end. Closing the last tab opens a blank tab.
   * @param id - The tab.
   */
  close(id: TabId): void {
    const index = this.indexOf(id);
    const [tab] = this.tabs.splice(index, 1);
    if (tab === undefined) {
      return;
    }
    this.closed.push(tab.url);
    if (this.closed.length > closedTabLimit) {
      this.closed.shift();
    }
    this.views.destroy(id);
    if (this.activeId === id) {
      this.activeId = undefined;
      const next = this.tabs[index] ?? this.tabs[index - 1];
      if (next === undefined) {
        this.open();
        return;
      }
      this.activate(next.id);
      return;
    }
    this.changeEmitter.fire();
  }

  /**
   * Reopens the most recently closed tab.
   * @returns The reopened tab's id, or `undefined` if nothing was closed.
   */
  reopenClosed(): TabId | undefined {
    const url = this.closed.pop();
    return url === undefined ? undefined : this.open(url);
  }

  /**
   * Loads a URL in a tab.
   * @param id - The tab.
   * @param url - The URL.
   */
  navigate(id: TabId, url: string): void {
    this.require(id);
    this.views.load(id, url);
  }

  /**
   * Runs a history or loading action in a tab.
   * @param id - The tab.
   * @param action - What to do.
   */
  run(id: TabId, action: 'back' | 'forward' | 'reload' | 'stop'): void {
    this.require(id);
    this.views.run(id, action);
  }

  /**
   * Applies state reported by the web view, such as a new title.
   * @param id - The tab.
   * @param update - Changed fields.
   */
  update(id: TabId, update: TabUpdate): void {
    const index = this.tabs.findIndex((t) => t.id === id);
    const current = this.tabs[index];
    if (current === undefined) {
      return;
    }
    const next = { ...current, ...update };
    if (
      tabFields.some((field) => update[field] !== undefined && update[field] !== current[field])
    ) {
      this.tabs[index] = next;
      this.changeEmitter.fire();
    }
  }

  /** Destroys every view and removes listeners. */
  dispose(): void {
    for (const tab of this.tabs.splice(0)) {
      this.views.destroy(tab.id);
    }
    this.changeEmitter.dispose();
  }

  private indexOf(id: TabId): number {
    const index = this.tabs.findIndex((t) => t.id === id);
    if (index === -1) {
      throw new Error(`Unknown tab ${id}`);
    }
    return index;
  }

  private require(id: TabId): void {
    this.indexOf(id);
  }
}
