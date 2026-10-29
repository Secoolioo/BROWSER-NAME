import { describe, expect, it } from 'vitest';
import {
  buildContextMenu,
  type ContextMenuAction,
  type ContextMenuEntry,
  type ContextMenuInput,
  type ContextMenuLabels,
  type ContextMenuParams,
} from '../context-menu/context-menu.ts';
import { mayOpenInNewTab } from '../navigation/new-tab.ts';

const labels: ContextMenuLabels = {
  openLinkInNewTab: 'Open link in new tab',
  copyLinkAddress: 'Copy link address',
  openImageInNewTab: 'Open image in new tab',
  copyImage: 'Copy image',
  copyImageAddress: 'Copy image address',
  undo: 'Undo',
  redo: 'Redo',
  cut: 'Cut',
  copy: 'Copy',
  paste: 'Paste',
  selectAll: 'Select all',
  back: 'Back',
  forward: 'Forward',
  reload: 'Reload',
  searchFor: (engine, query) => `Search ${engine} for “${query}”`,
};

const nothing: ContextMenuParams = {
  linkURL: '',
  srcURL: '',
  mediaType: 'none',
  hasImageContents: false,
  selectionText: '',
  isEditable: false,
  formControlType: 'none',
  dictionarySuggestions: [],
  editFlags: {
    canUndo: false,
    canRedo: false,
    canCut: false,
    canCopy: false,
    canPaste: false,
    canSelectAll: false,
  },
};

const textField: Partial<ContextMenuParams> = {
  isEditable: true,
  formControlType: 'input-text',
  editFlags: { ...nothing.editFlags, canPaste: true, canSelectAll: true },
};

const template = 'https://duckduckgo.com/?q=%s';

/** Builds the menu for some params on a page under Linux, unless the options say otherwise. */
function menu(
  params: Partial<ContextMenuParams>,
  options: Partial<Omit<ContextMenuInput, 'params'>> & { readonly platform?: string } = {},
): ContextMenuEntry[] {
  const { platform = 'linux', ...input } = options;
  return buildContextMenu(
    {
      surface: 'page',
      canGoBack: false,
      canGoForward: false,
      canCopyImage: true,
      searchTemplate: template,
      ...input,
      params: { ...nothing, ...params },
    },
    labels,
    platform,
  );
}

/** The menu as text: disabled items are marked `[off]`, shortcuts are in angle brackets. */
function render(entries: readonly ContextMenuEntry[]): string[] {
  return entries.map((entry) =>
    entry.type === 'separator'
      ? '---'
      : [
          entry.label,
          entry.enabled ? '' : '[off]',
          entry.accelerator ? `<${entry.accelerator}>` : '',
        ]
          .filter((part) => part !== '')
          .join(' '),
  );
}

/** The search item for the selection `x` with a search URL template, if there is one. */
function search(searchTemplate: string): string[] {
  return render(menu({ selectionText: 'x' }, { searchTemplate })).slice(1);
}

function actionOf(entries: readonly ContextMenuEntry[], label: string): ContextMenuAction {
  const entry = entries.find((e) => e.type === 'item' && e.label === label);
  if (entry?.type !== 'item') {
    throw new Error(`No item ${label}`);
  }
  return entry.action;
}

describe('mayOpenInNewTab', () => {
  it.each(['https://example.com/', 'http://127.0.0.1:8080/a', 'HTTPS://EXAMPLE.COM/'])(
    'lets pages open %s',
    (url) => {
      expect(mayOpenInNewTab(url)).toBe(true);
    },
  );

  it.each([
    'app://settings/',
    'file:///etc/passwd',
    'javascript:alert(1)',
    'data:text/html,hi',
    'blob:https://example.com/1',
    'about:blank',
    'mailto:someone@example.com',
    '',
  ])('never lets pages open %s', (url) => {
    expect(mayOpenInNewTab(url)).toBe(false);
  });
});

describe('buildContextMenu', () => {
  it('offers the history items when nothing specific was clicked', () => {
    expect(render(menu({}))).toEqual(['Back [off]', 'Forward [off]', 'Reload']);
    const entries = menu({}, { canGoBack: true, canGoForward: true, platform: 'win32' });
    expect(render(entries)).toEqual(['Back', 'Forward', 'Reload']);
    expect(['Back', 'Forward', 'Reload'].map((label) => actionOf(entries, label))).toEqual([
      { kind: 'navigate', command: 'back' },
      { kind: 'navigate', command: 'forward' },
      { kind: 'navigate', command: 'reload' },
    ]);
  });

  it('opens web links in a background tab and copies their address', () => {
    const url = 'https://example.com/a?b=c&d';
    const entries = menu({ linkURL: url });
    expect(render(entries)).toEqual(['Open link in new tab', 'Copy link address']);
    expect(actionOf(entries, 'Open link in new tab')).toEqual({
      kind: 'openTab',
      url,
      activate: false,
    });
    expect(actionOf(entries, 'Copy link address')).toEqual({ kind: 'copyText', text: url });
  });

  it.each(['app://settings/', 'file:///etc/passwd', 'javascript:alert(1)', 'data:,hi'])(
    'only copies a link or image address of %s',
    (url) => {
      expect(render(menu({ linkURL: url }))).toEqual(['Copy link address']);
      expect(render(menu({ mediaType: 'image', srcURL: url, hasImageContents: true }))).toEqual([
        'Copy image',
        'Copy image address',
      ]);
    },
  );

  it('offers the image items and copies only images that have loaded', () => {
    const src = 'https://example.com/i.png';
    const loaded = menu({ mediaType: 'image', srcURL: src, hasImageContents: true });
    expect(render(loaded)).toEqual(['Open image in new tab', 'Copy image', 'Copy image address']);
    expect(actionOf(loaded, 'Open image in new tab')).toEqual({
      kind: 'openTab',
      url: src,
      activate: false,
    });
    expect(actionOf(loaded, 'Copy image')).toEqual({ kind: 'copyImage' });
    expect(actionOf(loaded, 'Copy image address')).toEqual({ kind: 'copyText', text: src });
    expect(render(menu({ mediaType: 'image', srcURL: src }))).toEqual([
      'Open image in new tab',
      'Copy image [off]',
      'Copy image address',
    ]);
    expect(render(menu({ mediaType: 'image' }))).toEqual(['Copy image [off]']);
    expect(
      render(menu({ mediaType: 'image', hasImageContents: true }, { canCopyImage: false })),
    ).toEqual(['Copy image [off]']);
    expect(render(menu({ mediaType: 'video', srcURL: 'https://example.com/v.mp4' }))).toEqual([
      'Back [off]',
      'Forward [off]',
      'Reload',
    ]);
  });

  it('separates the link from the image it contains', () => {
    const entries = menu({
      linkURL: 'https://example.com/',
      mediaType: 'image',
      srcURL: 'https://example.com/i.png',
      hasImageContents: true,
    });
    expect(render(entries)).toEqual([
      'Open link in new tab',
      'Copy link address',
      '---',
      'Open image in new tab',
      'Copy image',
      'Copy image address',
    ]);
  });

  it('copies a selection and searches for it in a new active tab', () => {
    const params = {
      selectionText: '  Astela\n  browser ',
      editFlags: { ...nothing.editFlags, canCopy: true },
    };
    const entries = menu(params);
    expect(render(entries)).toEqual([
      'Copy <Ctrl+C>',
      'Search duckduckgo.com for “Astela browser”',
    ]);
    expect(actionOf(entries, 'Copy')).toEqual({ kind: 'edit', command: 'copy' });
    expect(actionOf(entries, 'Search duckduckgo.com for “Astela browser”')).toEqual({
      kind: 'openTab',
      url: 'https://duckduckgo.com/?q=Astela%20browser',
      activate: true,
    });
    expect(render(menu(params, { platform: 'darwin' }))).toEqual([
      'Copy',
      'Search duckduckgo.com for “Astela browser”',
    ]);
  });

  it('names the search engine by the host of the search URL', () => {
    expect(search('https://www.search.example:8443/find?q=%s')).toEqual([
      'Search search.example for “x”',
    ]);
    expect(search('https://user@[::1]:8443/?q=%s')).toEqual(['Search [::1] for “x”']);
    expect(search('https://?q=%s')).toEqual(['Search https://?q=%s for “x”']);
    expect(search('ftp://search.example/?q=%s')).toEqual([]);
  });

  it('shortens long selections in the label and keeps ampersands visible', () => {
    const query = `Q&A ${'x'.repeat(60)}`;
    const entries = menu({ selectionText: query });
    const label = render(entries)[1] ?? '';
    expect(label).toBe(`Search duckduckgo.com for “Q&&A ${'x'.repeat(46)}…”`);
    expect(actionOf(entries, label)).toEqual({
      kind: 'openTab',
      url: `https://duckduckgo.com/?q=Q%26A%20${'x'.repeat(60)}`,
      activate: true,
    });
    const emoji = render(menu({ selectionText: '😀'.repeat(60) }))[1] ?? '';
    expect(emoji).toBe(`Search duckduckgo.com for “${'😀'.repeat(50)}…”`);
    const family = '👩‍👩‍👧';
    const joined = render(menu({ selectionText: `${'a'.repeat(49)}${family}bbbbb` }))[1] ?? '';
    expect(joined).toBe(`Search duckduckgo.com for “${'a'.repeat(49)}${family}…”`);
  });

  it('offers no search for a selection that makes too long an address', () => {
    const searches = (selectionText: string): string[] =>
      render(menu({ selectionText })).filter((label) => label.startsWith('Search'));
    expect(searches('a'.repeat(8000))).toHaveLength(1);
    expect(searches('a'.repeat(8193))).toEqual([]);
    expect(searches('中'.repeat(1000))).toEqual([]);
    expect(render(menu({ selectionText: 'a'.repeat(3_000_000) }))).toEqual(['Copy [off] <Ctrl+C>']);
  });

  it('ignores a selection of white space', () => {
    expect(render(menu({ selectionText: ' \n\t ' }))).toEqual([
      'Back [off]',
      'Forward [off]',
      'Reload',
    ]);
  });

  it('offers the text field commands as the edit flags allow, with the shortcuts of the system', () => {
    expect(render(menu(textField))).toEqual([
      'Undo [off] <Ctrl+Z>',
      'Redo [off] <Ctrl+Shift+Z>',
      '---',
      'Cut [off] <Ctrl+X>',
      'Copy [off] <Ctrl+C>',
      'Paste <Ctrl+V>',
      'Select all <Ctrl+A>',
    ]);
    expect(render(menu(textField, { platform: 'win32' })).slice(0, 2)).toEqual([
      'Undo [off] <Ctrl+Z>',
      'Redo [off] <Ctrl+Y>',
    ]);
    expect(render(menu(textField, { platform: 'freebsd' }))[1]).toBe('Redo [off] <Ctrl+Shift+Z>');
    const mac = menu(
      { ...textField, editFlags: { ...nothing.editFlags, canUndo: true, canCut: true } },
      { platform: 'darwin' },
    );
    expect(render(mac)).toEqual([
      'Undo',
      'Redo [off]',
      '---',
      'Cut',
      'Copy [off]',
      'Paste [off]',
      'Select all [off]',
    ]);
    expect(
      ['Undo', 'Redo', 'Cut', 'Copy', 'Paste', 'Select all'].map((label) => actionOf(mac, label)),
    ).toEqual(
      (['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll'] as const).map((command) => ({
        kind: 'edit',
        command,
      })),
    );
  });

  it('adds the search for a selection in a text field, but not in a password field', () => {
    const selected = { ...textField, selectionText: 'hello' };
    expect(render(menu(selected)).slice(-2)).toEqual(['---', 'Search duckduckgo.com for “hello”']);
    expect(render(menu(selected)).filter((label) => label.startsWith('Copy'))).toHaveLength(1);
    expect(render(menu({ ...selected, formControlType: 'input-password' })).at(-1)).toBe(
      'Select all <Ctrl+A>',
    );
  });

  it('puts spelling suggestions first and replaces the misspelled word', () => {
    const suggestions = ['their', 'there', 'they&re', 'the', 'thee', 'then'];
    const entries = menu({ ...textField, dictionarySuggestions: suggestions });
    expect(render(entries).slice(0, 6)).toEqual([
      'their',
      'there',
      'they&&re',
      'the',
      'thee',
      '---',
    ]);
    expect(actionOf(entries, 'they&&re')).toEqual({ kind: 'replaceMisspelling', word: 'they&re' });
  });

  it('gives the shell nothing but the text field commands', () => {
    const shell = { surface: 'shell' } as const;
    expect(
      render(
        menu({ ...textField, selectionText: 'example.com', linkURL: 'https://x.example/' }, shell),
      ),
    ).toEqual(render(menu(textField)));
    expect(menu({}, shell)).toEqual([]);
    expect(menu({ selectionText: 'tab title', mediaType: 'image' }, shell)).toEqual([]);
  });
});
