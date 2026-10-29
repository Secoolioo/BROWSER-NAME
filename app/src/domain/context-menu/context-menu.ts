import { mayOpenInNewTab } from '../navigation/new-tab.ts';
import { searchUrl } from '../navigation/omnibox.ts';

/** What Chromium believes the clicked element allows. */
export interface EditFlags {
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly canCut: boolean;
  readonly canCopy: boolean;
  readonly canPaste: boolean;
  readonly canSelectAll: boolean;
}

/**
 * What was clicked: the fields of Electron's `ContextMenuParams` that the menu uses, so
 * Electron's object can be passed as it is.
 */
export interface ContextMenuParams {
  /** URL of the link around the clicked element, or an empty string. */
  readonly linkURL: string;
  /** URL of the clicked image, audio or video, or an empty string. */
  readonly srcURL: string;
  /** Kind of the clicked media, such as `image`, or `none`. */
  readonly mediaType: string;
  /** Whether the clicked image has loaded. */
  readonly hasImageContents: boolean;
  /** The selected text, or an empty string. */
  readonly selectionText: string;
  /** Whether the click was in an editable field. */
  readonly isEditable: boolean;
  /** Kind of the clicked form control, such as `input-password`, or `none`. */
  readonly formControlType: string;
  /** Replacements for the misspelled word under the pointer, when spell checking is on. */
  readonly dictionarySuggestions: readonly string[];
  readonly editFlags: EditFlags;
}

/** Everything the menu depends on besides its texts. */
export interface ContextMenuInput {
  /** A web page in a tab, or the browser's own shell, which only has text field menus. */
  readonly surface: 'page' | 'shell';
  readonly params: ContextMenuParams;
  /** Whether the page can go back in its history. */
  readonly canGoBack: boolean;
  /** Whether the page can go forward in its history. */
  readonly canGoForward: boolean;
  /**
   * Whether the clicked image can be copied from where it is. Electron copies images
   * through the main frame, which cannot reach a frame of another site in its own process.
   */
  readonly canCopyImage: boolean;
  /** Search URL with `%s` for the query: the `search.urlTemplate` setting. */
  readonly searchTemplate: string;
}

/** The texts of the menu items in the user's language. */
export interface ContextMenuLabels {
  readonly openLinkInNewTab: string;
  readonly copyLinkAddress: string;
  readonly openImageInNewTab: string;
  readonly copyImage: string;
  readonly copyImageAddress: string;
  readonly undo: string;
  readonly redo: string;
  readonly cut: string;
  readonly copy: string;
  readonly paste: string;
  readonly selectAll: string;
  readonly back: string;
  readonly forward: string;
  readonly reload: string;
  /**
   * The text of the item that searches for the selection.
   * @param engine - Host name of the search engine, such as `duckduckgo.com`.
   * @param query - The selection, shortened for the menu.
   */
  searchFor(engine: string, query: string): string;
}

/** An editing command. It runs in the focused frame of the view that opened the menu. */
export type EditCommand = 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'selectAll';

/**
 * What a menu item does. `openTab` opens a URL in a new tab next to the page, in the
 * background unless `activate` is set; `copyImage` copies the image that was clicked.
 */
export type ContextMenuAction =
  | { readonly kind: 'openTab'; readonly url: string; readonly activate: boolean }
  | { readonly kind: 'copyText'; readonly text: string }
  | { readonly kind: 'copyImage' }
  | { readonly kind: 'edit'; readonly command: EditCommand }
  | { readonly kind: 'replaceMisspelling'; readonly word: string }
  | { readonly kind: 'navigate'; readonly command: 'back' | 'forward' | 'reload' };

/** One item of the menu. */
export interface ContextMenuItem {
  readonly type: 'item';
  /** The text. A single `&` marks a mnemonic in native menus, so text from pages has it doubled. */
  readonly label: string;
  readonly enabled: boolean;
  /** Shortcut shown next to the text, in Electron's accelerator syntax. */
  readonly accelerator?: string;
  readonly action: ContextMenuAction;
}

/** An item, or a separator between two groups of items. */
export type ContextMenuEntry = ContextMenuItem | { readonly type: 'separator' };

/** Longest part of a selection that the search item shows, in characters, as in Chromium. */
const maxShownQueryLength = 50;

/** Longest search address the menu opens; many servers refuse longer request lines. */
const maxSearchUrlLength = 8192;

/** Most spelling suggestions offered, so a long list does not push the commands away. */
const maxSuggestions = 5;

const separator: ContextMenuEntry = { type: 'separator' };

/**
 * Describes the context menu for a click, for Electron to show as a native menu. The groups
 * follow Chromium's menus: link, image, text field with spelling suggestions first, then
 * the selection. A page where nothing specific was clicked gets the history items; the
 * shell gets the text field items only.
 * @param input - What was clicked and where.
 * @param labels - The texts in the user's language.
 * @param platform - `process.platform`. Windows and Linux show the shortcuts of the editing
 *   commands; macOS context menus show none.
 * @returns The entries; none when there is nothing to offer.
 */
export function buildContextMenu(
  input: ContextMenuInput,
  labels: ContextMenuLabels,
  platform: string,
): ContextMenuEntry[] {
  const { params } = input;
  const page = input.surface === 'page';
  const groups: ContextMenuItem[][] = [];
  if (page) {
    groups.push(linkItems(params, labels), imageItems(input, labels));
  }
  if (params.isEditable) {
    groups.push(spellingItems(params), ...editItems(params, labels, platform));
  }
  if (page) {
    groups.push(selectionItems(input, labels, platform));
  }
  const filled = groups.filter((group) => group.length > 0);
  if (page && filled.length === 0) {
    filled.push(historyItems(input, labels));
  }
  const entries: ContextMenuEntry[] = [];
  for (const group of filled) {
    if (entries.length > 0) {
      entries.push(separator);
    }
    entries.push(...group);
  }
  return entries;
}

function linkItems({ linkURL }: ContextMenuParams, labels: ContextMenuLabels): ContextMenuItem[] {
  if (linkURL === '') {
    return [];
  }
  return [
    ...(mayOpenInNewTab(linkURL)
      ? [item(labels.openLinkInNewTab, { kind: 'openTab', url: linkURL, activate: false })]
      : []),
    item(labels.copyLinkAddress, { kind: 'copyText', text: linkURL }),
  ];
}

function imageItems(input: ContextMenuInput, labels: ContextMenuLabels): ContextMenuItem[] {
  const { params } = input;
  const { srcURL } = params;
  if (params.mediaType !== 'image') {
    return [];
  }
  return [
    ...(mayOpenInNewTab(srcURL)
      ? [item(labels.openImageInNewTab, { kind: 'openTab', url: srcURL, activate: false })]
      : []),
    item(labels.copyImage, { kind: 'copyImage' }, params.hasImageContents && input.canCopyImage),
    ...(srcURL === '' ? [] : [item(labels.copyImageAddress, { kind: 'copyText', text: srcURL })]),
  ];
}

function spellingItems(params: ContextMenuParams): ContextMenuItem[] {
  return params.dictionarySuggestions
    .slice(0, maxSuggestions)
    .map((word) => item(escapeMnemonics(word), { kind: 'replaceMisspelling', word }));
}

function editItems(
  { editFlags: flags }: ContextMenuParams,
  labels: ContextMenuLabels,
  platform: string,
): ContextMenuItem[][] {
  const edit = (label: string, command: EditCommand, enabled: boolean): ContextMenuItem =>
    item(label, { kind: 'edit', command }, enabled, shortcut(command, platform));
  return [
    [edit(labels.undo, 'undo', flags.canUndo), edit(labels.redo, 'redo', flags.canRedo)],
    [
      edit(labels.cut, 'cut', flags.canCut),
      edit(labels.copy, 'copy', flags.canCopy),
      edit(labels.paste, 'paste', flags.canPaste),
      edit(labels.selectAll, 'selectAll', flags.canSelectAll),
    ],
  ];
}

function selectionItems(
  input: ContextMenuInput,
  labels: ContextMenuLabels,
  platform: string,
): ContextMenuItem[] {
  const { params } = input;
  const query = params.selectionText.replace(/\s+/g, ' ').trim();
  if (query === '') {
    return [];
  }
  // A text field has its own Copy item.
  const items = params.isEditable
    ? []
    : [
        item(
          labels.copy,
          { kind: 'edit', command: 'copy' },
          params.editFlags.canCopy,
          shortcut('copy', platform),
        ),
      ];
  // Encoding never shortens a query, so a selection that is too long is not even encoded.
  if (params.formControlType === 'input-password' || query.length > maxSearchUrlLength) {
    return items;
  }
  const url = searchUrl(query, input.searchTemplate);
  if (url.length <= maxSearchUrlLength && mayOpenInNewTab(url)) {
    const label = labels.searchFor(
      escapeMnemonics(engineOf(input.searchTemplate)),
      escapeMnemonics(shorten(query)),
    );
    items.push(item(label, { kind: 'openTab', url, activate: true }));
  }
  return items;
}

function historyItems(input: ContextMenuInput, labels: ContextMenuLabels): ContextMenuItem[] {
  return [
    item(labels.back, { kind: 'navigate', command: 'back' }, input.canGoBack),
    item(labels.forward, { kind: 'navigate', command: 'forward' }, input.canGoForward),
    item(labels.reload, { kind: 'navigate', command: 'reload' }),
  ];
}

function item(
  label: string,
  action: ContextMenuAction,
  enabled = true,
  accelerator?: string,
): ContextMenuItem {
  return {
    type: 'item',
    label,
    enabled,
    action,
    ...(accelerator === undefined ? {} : { accelerator }),
  };
}

/** The shortcut of an editing command as Windows and Linux show it; macOS shows none. */
function shortcut(command: EditCommand, platform: string): string | undefined {
  if (platform === 'darwin') {
    return undefined;
  }
  const keys: Readonly<Record<EditCommand, string>> = {
    undo: 'Ctrl+Z',
    redo: platform === 'win32' ? 'Ctrl+Y' : 'Ctrl+Shift+Z',
    cut: 'Ctrl+X',
    copy: 'Ctrl+C',
    paste: 'Ctrl+V',
    selectAll: 'Ctrl+A',
  };
  return keys[command];
}

/** The host name of a search URL template without `www.`, such as `duckduckgo.com`. */
function engineOf(template: string): string {
  const host = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/?#]*@)?(\[[^\]]*\]|[^/?#:]*)/i.exec(template)?.[1];
  return host?.replace(/^www\./i, '') || template;
}

/**
 * Cuts a text to the length the menu shows, without splitting a character such as an emoji.
 * It stops reading after that length, because a selection can be megabytes long.
 */
function shorten(text: string): string {
  const characters: string[] = [];
  for (const { segment } of new Intl.Segmenter().segment(text)) {
    if (characters.length === maxShownQueryLength) {
      return `${characters.join('').trimEnd()}…`;
    }
    characters.push(segment);
  }
  return text;
}

/** Doubles `&`, which native menus would otherwise take as the mark of a mnemonic. */
function escapeMnemonics(text: string): string {
  return text.replaceAll('&', '&&');
}
