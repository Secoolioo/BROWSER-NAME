import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from 'lit';
import type { ShellState, TabView } from '../../shared/ipc/shell-contracts.ts';
import type { Translator } from '../i18n/i18n.ts';
import type { ShellBridge } from './bridge.ts';

/**
 * The browser shell: tab strip, navigation buttons and the address bar. It renders the
 * state that the browser process sends and reports the space it needs, so web content
 * fills the rest of the window.
 */
export class AppShell extends LitElement {
  static override properties = {
    state: { state: true },
    editing: { state: true },
  };

  static override styles = css`
    :host {
      display: block;
      position: fixed;
      inset: 0 0 auto 0;
      background: var(--surface-0);
      border-bottom: 1px solid var(--border-1);
      user-select: none;
    }
    [role='tablist'] {
      display: flex;
      gap: 2px;
      height: var(--tab-height);
      padding: var(--space-1) var(--space-2) 0;
      overflow-x: auto;
      scrollbar-width: none;
    }
    .tab {
      display: flex;
      align-items: center;
      gap: var(--space-1);
      min-width: 0;
      flex: 0 1 220px;
      padding: 0 var(--space-1) 0 var(--space-3);
      border: 0;
      border-radius: var(--radius-1) var(--radius-1) 0 0;
      background: transparent;
      color: var(--text-2);
      font: inherit;
      text-align: start;
      transition: background-color var(--motion-fast) ease-out;
    }
    .tab:hover {
      background: var(--surface-hover);
    }
    .tab[aria-selected='true'] {
      background: var(--surface-1);
      color: var(--text-1);
    }
    .title {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
    }
    .loading {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--accent);
      flex: none;
    }
    button {
      cursor: default;
    }
    .icon {
      display: grid;
      place-items: center;
      width: 28px;
      height: 28px;
      flex: none;
      border: 0;
      border-radius: var(--radius-1);
      background: transparent;
      color: inherit;
      font: inherit;
    }
    .icon:hover:not(:disabled) {
      background: var(--surface-hover);
    }
    .icon:disabled {
      opacity: 0.4;
    }
    .close {
      width: 24px;
      height: 24px;
    }
    nav {
      display: flex;
      align-items: center;
      gap: var(--space-1);
      height: var(--toolbar-height);
      padding: 0 var(--space-2);
      background: var(--surface-1);
    }
    input {
      flex: 1;
      min-width: 0;
      height: 30px;
      padding: 0 var(--space-3);
      border: 1px solid var(--border-1);
      border-radius: var(--radius-2);
      background: var(--surface-0);
      color: var(--text-1);
      font: inherit;
    }
    :focus-visible {
      outline: 2px solid var(--focus-ring);
      outline-offset: 1px;
    }
    svg {
      width: 16px;
      height: 16px;
      fill: none;
      stroke: currentColor;
      stroke-width: 1.5;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
  `;

  declare state: ShellState;
  declare editing: string | undefined;
  bridge: ShellBridge | undefined;
  i18n: Translator | undefined;
  private resizeObserver: ResizeObserver | undefined;
  private unsubscribers: (() => void)[] = [];

  constructor() {
    super();
    this.state = { tabs: [], activeTabId: null };
    this.editing = undefined;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    const bridge = this.bridge;
    if (bridge === undefined) {
      return;
    }
    this.unsubscribers.push(
      bridge.on('shell.stateChanged', (state) => (this.state = state)),
      bridge.on('shell.command', () => this.focusAddress()),
    );
    void bridge.invoke('shell.getState', {}).then((state) => (this.state = state));
    this.resizeObserver = new ResizeObserver(() => this.reportInsets());
    this.resizeObserver.observe(this);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.resizeObserver?.disconnect();
    for (const unsubscribe of this.unsubscribers.splice(0)) {
      unsubscribe();
    }
  }

  protected override updated(changed: PropertyValues<this>): void {
    if (changed.has('state') && this.active === undefined) {
      this.editing = undefined;
    }
  }

  protected override render(): TemplateResult {
    const t = (key: Parameters<Translator['t']>[0]): string => this.i18n?.t(key) ?? key;
    const active = this.active;
    return html`
      <div role="tablist" aria-label=${t('shell.tabs')}>
        ${this.state.tabs.map((tab) => this.renderTab(tab, t))}
        <button
          class="icon"
          title=${t('shell.newTab')}
          aria-label=${t('shell.newTab')}
          @click=${this.newTab}
        >
          ${icons.plus}
        </button>
      </div>
      <nav aria-label=${t('shell.toolbar')}>
        <button
          class="icon"
          title=${t('shell.back')}
          aria-label=${t('shell.back')}
          ?disabled=${active?.canGoBack !== true}
          @click=${() => this.action('back')}
        >
          ${icons.back}
        </button>
        <button
          class="icon"
          title=${t('shell.forward')}
          aria-label=${t('shell.forward')}
          ?disabled=${active?.canGoForward !== true}
          @click=${() => this.action('forward')}
        >
          ${icons.forward}
        </button>
        ${
          active?.loading === true
            ? html`<button
                class="icon"
                title=${t('shell.stop')}
                aria-label=${t('shell.stop')}
                @click=${() => this.action('stop')}
              >
                ${icons.stop}
              </button>`
            : html`<button
                class="icon"
                title=${t('shell.reload')}
                aria-label=${t('shell.reload')}
                @click=${() => this.action('reload')}
              >
                ${icons.reload}
              </button>`
        }
        <input
          type="text"
          spellcheck="false"
          autocomplete="off"
          aria-label=${t('shell.address')}
          placeholder=${t('shell.addressPlaceholder')}
          .value=${this.editing ?? displayUrl(active?.url)}
          @focus=${(e: FocusEvent) => inputOf(e)?.select()}
          @input=${(e: InputEvent) => (this.editing = inputOf(e)?.value)}
          @keydown=${this.onAddressKey}
          @blur=${() => (this.editing = undefined)}
        />
      </nav>
    `;
  }

  private renderTab(
    tab: TabView,
    t: (key: Parameters<Translator['t']>[0]) => string,
  ): TemplateResult {
    const selected = tab.id === this.state.activeTabId;
    const title = tab.title || displayUrl(tab.url) || t('shell.untitled');
    return html`
      <div
        class="tab"
        role="tab"
        tabindex=${selected ? 0 : -1}
        aria-selected=${selected ? 'true' : 'false'}
        title=${title}
        @click=${() => void this.bridge?.invoke('tabs.activate', { tabId: tab.id })}
        @auxclick=${(e: MouseEvent) => e.button === 1 && this.close(tab.id)}
      >
        ${tab.loading ? html`<span class="loading" role="img" aria-label=${t('shell.loading')}></span>` : nothing}
        <span class="title">${title}</span>
        <button
          class="icon close"
          tabindex="-1"
          aria-label=${t('shell.closeTab')}
          @click=${(e: Event) => (e.stopPropagation(), this.close(tab.id))}
        >
          ${icons.close}
        </button>
      </div>
    `;
  }

  private get active(): TabView | undefined {
    return this.state.tabs.find((tab) => tab.id === this.state.activeTabId);
  }

  private readonly newTab = (): void => {
    void this.bridge?.invoke('tabs.open', {});
  };

  private close(tabId: string): void {
    void this.bridge?.invoke('tabs.close', { tabId });
  }

  private action(action: 'back' | 'forward' | 'reload' | 'stop'): void {
    const tabId = this.state.activeTabId;
    if (tabId !== null) {
      void this.bridge?.invoke('tabs.action', { tabId, action });
    }
  }

  private readonly onAddressKey = (event: KeyboardEvent): void => {
    const input = inputOf(event);
    if (input === undefined) {
      return;
    }
    if (event.key === 'Escape') {
      this.editing = undefined;
      input.value = displayUrl(this.active?.url);
      input.select();
    }
    if (event.key !== 'Enter' || input.value.trim() === '') {
      return;
    }
    const tabId = this.state.activeTabId;
    void (tabId === null
      ? this.bridge?.invoke('tabs.open', { input: input.value })
      : this.bridge?.invoke('tabs.navigate', { tabId, input: input.value }));
    this.editing = undefined;
    input.blur();
  };

  private focusAddress(): void {
    const input = this.renderRoot.querySelector('input');
    input?.focus();
    input?.select();
  }

  private reportInsets(): void {
    const top = Math.ceil(this.getBoundingClientRect().height);
    void this.bridge?.invoke('shell.setInsets', { top, right: 0, bottom: 0, left: 0 });
  }
}

function inputOf(event: Event): HTMLInputElement | undefined {
  return event.target instanceof HTMLInputElement ? event.target : undefined;
}

function displayUrl(url: string | undefined): string {
  return url === undefined || url === 'about:blank' ? '' : url;
}

/** Icons drawn after Lucide (ISC license), inlined so the shell needs no icon requests. */
const icons = {
  plus: html`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M12 5v14" /></svg>`,
  close: html`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>`,
  back: html`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 19-7-7 7-7M19 12H5" /></svg>`,
  forward: html`<svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M5 12h14M12 5l7 7-7 7" />
  </svg>`,
  reload: html`<svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M21 12a9 9 0 1 1-3-6.7L21 8" />
    <path d="M21 3v5h-5" />
  </svg>`,
  stop: html`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>`,
};
