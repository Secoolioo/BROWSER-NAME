import { app, clipboard, Menu, type MenuItemConstructorOptions, type WebContents } from 'electron';
import type { Logger } from '../kernel/logging/logger.ts';
import {
  buildContextMenu,
  type ContextMenuAction,
  type ContextMenuEntry,
} from '../domain/context-menu/context-menu.ts';
import type { ContextMenuRequest } from '../platform/electron/browser-window.ts';
import { contextMenuLabels } from './context-menu-labels.ts';

/** What the context menu needs from the composition root. */
export interface ContextMenuDependencies {
  /** The search URL template, once the settings have loaded. */
  readonly searchTemplate: () => Promise<string>;
  /**
   * Opens a URL from a page in a new tab next to it: the path and the guard of every tab
   * that a page opens.
   */
  readonly openTab: (url: string, opener: WebContents, activate: boolean) => void;
  readonly logger: Logger;
}

/**
 * Shows the native context menu for a click in a page or in the shell. This module loads
 * with the first context menu, so it adds nothing to the start of the browser.
 * @param request - The view and what was clicked in it.
 * @param deps - Settings and the tab path of the composition root.
 */
export async function popupContextMenu(
  request: ContextMenuRequest,
  deps: ContextMenuDependencies,
): Promise<void> {
  const searchTemplate = await deps.searchTemplate();
  const { window, tabId, contents, params, bounds } = request;
  if (contents.isDestroyed() || window.window.isDestroyed()) {
    return;
  }
  const history = tabId === undefined ? undefined : contents.navigationHistory;
  const entries = buildContextMenu(
    {
      surface: tabId === undefined ? 'shell' : 'page',
      params,
      canGoBack: history?.canGoBack() ?? false,
      canGoForward: history?.canGoForward() ?? false,
      canCopyImage: params.frame?.processId === contents.mainFrame.processId,
      searchTemplate,
    },
    contextMenuLabels(app.getLocale(), process.platform),
    process.platform,
  );
  if (entries.length === 0) {
    return;
  }
  const menu = Menu.buildFromTemplate(entries.map((entry) => menuItem(entry, request, deps)));
  // A menu opened with the keyboard belongs next to the focused element, not at the pointer.
  const position =
    params.menuSourceType === 'keyboard' ? { x: bounds.x + params.x, y: bounds.y + params.y } : {};
  menu.popup({
    window: window.window,
    sourceType: params.menuSourceType,
    ...position,
    // Lets system features of macOS, such as Writing Tools, work on the clicked frame.
    ...(params.frame ? { frame: params.frame } : {}),
  });
}

function menuItem(
  entry: ContextMenuEntry,
  request: ContextMenuRequest,
  deps: ContextMenuDependencies,
): MenuItemConstructorOptions {
  if (entry.type === 'separator') {
    return { type: 'separator' };
  }
  return {
    label: entry.label,
    enabled: entry.enabled,
    // The shortcut is only shown; the view handles the key itself.
    ...(entry.accelerator === undefined
      ? {}
      : { accelerator: entry.accelerator, registerAccelerator: false }),
    click: () => {
      try {
        run(entry.action, request, deps);
      } catch (error: unknown) {
        deps.logger.error('A context menu command failed', error, { action: entry.action.kind });
      }
    },
  };
}

/**
 * Carries out an item in the view that opened the menu. Menu roles would act on the focused
 * view instead, which need not be the clicked one, and macOS would enable them regardless
 * of the edit flags; so every command names its web contents.
 */
function run(
  action: ContextMenuAction,
  request: ContextMenuRequest,
  deps: ContextMenuDependencies,
): void {
  const { window, tabId, contents, params } = request;
  if (contents.isDestroyed()) {
    return;
  }
  switch (action.kind) {
    case 'openTab':
      deps.openTab(action.url, contents, action.activate);
      break;
    case 'copyText':
      void clipboard
        .writeText(action.text)
        .catch((error: unknown) => deps.logger.error('The address could not be copied', error));
      break;
    case 'copyImage':
      contents.copyImageAt(params.x, params.y);
      break;
    case 'edit':
      contents[action.command]();
      break;
    case 'replaceMisspelling':
      contents.replaceMisspelling(action.word);
      break;
    case 'navigate':
      if (tabId !== undefined && window.tabs.all.some((tab) => tab.id === tabId)) {
        window.tabs.run(tabId, action.command);
      }
      break;
  }
}
