import { expect, test, type Page } from '@playwright/test';
import type * as Electron from 'electron';
import { FixtureServer, launch, shellState, waitForPage, type Browser } from './harness.ts';

const server = new FixtureServer();
let browser: Browser;

test.beforeAll(async () => {
  await server.start();
});
test.afterAll(async () => {
  await server.stop();
});
test.afterEach(async () => {
  await browser.close();
});

/**
 * The English texts as the browser hands them to Electron: with access keys on Windows and
 * Linux, and in title case on macOS, whose menus show no access keys.
 */
const en =
  process.platform === 'darwin'
    ? {
        openLink: 'Open Link in New Tab',
        copyLink: 'Copy Link Address',
        openImage: 'Open Image in New Tab',
        copyImage: 'Copy Image',
        copyImageAddress: 'Copy Image Address',
        search: 'Search duckduckgo.com for “Fixture menus”',
        undo: 'Undo',
        redo: 'Redo',
        cut: 'Cut',
        copy: 'Copy',
        paste: 'Paste',
        selectAll: 'Select All',
        back: 'Back',
        forward: 'Forward',
        reload: 'Reload',
      }
    : {
        openLink: 'Open link in new &tab',
        copyLink: 'Copy link addr&ess',
        openImage: 'Open &image in new tab',
        copyImage: 'Cop&y image',
        copyImageAddress: 'C&opy image address',
        search: '&Search duckduckgo.com for “Fixture menus”',
        undo: '&Undo',
        redo: '&Redo',
        cut: 'Cu&t',
        copy: '&Copy',
        paste: '&Paste',
        selectAll: 'Select &all',
        back: '&Back',
        forward: '&Forward',
        reload: '&Reload',
      };

/** A context menu as the browser built it; `-` stands for a separator. */
interface ShownMenu {
  readonly items: readonly string[];
  readonly disabled: readonly string[];
  readonly options: {
    readonly x?: number | undefined;
    readonly y?: number | undefined;
    readonly sourceType?: string | undefined;
  };
}

/** What the main process records for each menu instead of showing it. */
interface Recorded {
  readonly menu: Electron.Menu;
  readonly options: Electron.PopupOptions;
}

/**
 * Starts the browser and makes it record its context menus instead of showing them, so the
 * tests can read them and choose items in the same way on every system.
 * @param args - Further command line switches.
 */
async function start(args: readonly string[] = []): Promise<void> {
  browser = await launch(args);
  await browser.main.evaluate(({ Menu }) => {
    const recorded: Recorded[] = [];
    Object.assign(globalThis, { recordedMenus: recorded });
    Menu.prototype.popup = function popup(
      this: Electron.Menu,
      options: Electron.PopupOptions = {},
    ) {
      recorded.push({ menu: this, options });
    };
  });
}

/** Opens a fixture page from the address bar. */
async function open(name: string): Promise<Page> {
  const address = browser.shell.getByRole('textbox');
  await address.fill(`${server.origin}/${name}`);
  await address.press('Enter');
  const page = await waitForPage(browser, (url) => url.endsWith(`/${name}`));
  await page.waitForLoadState();
  return page;
}

/**
 * Waits until the browser has built a number of menus and returns the last one.
 * @param count - How many menus the test has opened so far.
 */
async function menu(count: number): Promise<ShownMenu> {
  await expect
    .poll(() =>
      browser.main.evaluate(
        () => (globalThis as unknown as { recordedMenus: Recorded[] }).recordedMenus.length,
      ),
    )
    .toBe(count);
  return browser.main.evaluate(() => {
    const { recordedMenus } = globalThis as unknown as { recordedMenus: Recorded[] };
    const { menu: shown, options } = recordedMenus[recordedMenus.length - 1] as Recorded;
    return {
      items: shown.items.map((item) => (item.type === 'separator' ? '-' : item.label)),
      disabled: shown.items.filter((item) => !item.enabled).map((item) => item.label),
      options: { x: options.x, y: options.y, sourceType: options.sourceType },
    };
  });
}

/** Chooses an item of the last menu, as a click on it would. */
async function choose(label: string): Promise<void> {
  await browser.main.evaluate((_electron, wanted) => {
    const { recordedMenus } = globalThis as unknown as { recordedMenus: Recorded[] };
    const item = recordedMenus.at(-1)?.menu.items.find((candidate) => candidate.label === wanted);
    if (item === undefined) throw new Error(`No menu item ${wanted}`);
    item.click();
  }, label);
}

/**
 * Checks the items of a menu. On macOS, a right-click on text or a link also selects the
 * word or the link under the pointer, as everywhere on that system, so the menu may end
 * with the items for that selection.
 */
function expectItems(shown: ShownMenu, expected: readonly string[]): void {
  const items = process.platform === 'darwin' ? shown.items.slice(0, expected.length) : shown.items;
  expect(items).toEqual(expected);
}

function clipboardText(): Promise<string> {
  return browser.main.evaluate(({ clipboard }) => clipboard.readText());
}

async function tabUrls(): Promise<{ urls: string[]; active: string | undefined }> {
  const state = await shellState(browser.shell);
  return {
    urls: state.tabs.map((tab) => tab.url),
    active: state.tabs.find((tab) => tab.id === state.activeTabId)?.url,
  };
}

test('opens links in a background tab, copies their address and keeps internal pages closed', async () => {
  await start();
  const page = await open('menus.html');
  await page.click('#link', { button: 'right' });
  const link = await menu(1);
  expectItems(link, [en.openLink, en.copyLink]);
  expect(link.options).toEqual({ sourceType: 'mouse' });
  await choose(en.openLink);
  await expect.poll(tabUrls).toEqual({
    urls: [`${server.origin}/menus.html`, `${server.origin}/second.html`],
    active: `${server.origin}/menus.html`,
  });
  await choose(en.copyLink);
  await expect.poll(clipboardText).toBe(`${server.origin}/second.html`);
  await page.click('#internal', { button: 'right' });
  expectItems(await menu(2), [en.copyLink]);
});

test('copies a selection and searches for it in a new tab', async () => {
  await start();
  // Nothing leaves the machine: requests to anything but the fixture server fail.
  await browser.main.evaluate(({ session }) => {
    session.fromPartition('persist:default').webRequest.onBeforeRequest((details, callback) => {
      callback({ cancel: !details.url.startsWith('http://127.0.0.1:') });
    });
  });
  const page = await open('menus.html');
  await page.evaluate(() => {
    const range = document.createRange();
    range.selectNodeContents(document.getElementById('text') as HTMLElement);
    getSelection()?.removeAllRanges();
    getSelection()?.addRange(range);
  });
  await page.click('#text', { button: 'right' });
  expect((await menu(1)).items).toEqual([en.copy, en.search]);
  await choose(en.copy);
  await expect.poll(clipboardText).toBe('Fixture menus');
  await choose(en.search);
  await expect
    .poll(async () => (await tabUrls()).active)
    .toBe('https://duckduckgo.com/?q=Fixture%20menus');
});

test('opens and copies images', async () => {
  await start();
  const page = await open('menus.html');
  await page.waitForFunction(
    () => (document.getElementById('image') as HTMLImageElement).naturalWidth > 0,
  );
  await page.click('#image', { button: 'right' });
  expectItems(await menu(1), [en.openImage, en.copyImage, en.copyImageAddress]);
  await choose(en.copyImageAddress);
  await expect.poll(clipboardText).toBe(`${server.origin}/image.png`);
  await choose(en.copyImage);
  await expect
    .poll(() =>
      browser.main.evaluate(async ({ clipboard }) =>
        (await clipboard.read()).some((item) =>
          item.types.some((type) => type.startsWith('image/')),
        ),
      ),
    )
    .toBe(true);
  await choose(en.openImage);
  await expect
    .poll(async () => (await tabUrls()).urls)
    .toEqual([`${server.origin}/menus.html`, `${server.origin}/image.png`]);
  // A further background tab from the same page goes after the first one.
  await page.click('#link', { button: 'right' });
  await menu(2);
  await choose(en.openLink);
  await expect.poll(tabUrls).toEqual({
    urls: [
      `${server.origin}/menus.html`,
      `${server.origin}/image.png`,
      `${server.origin}/second.html`,
    ],
    active: `${server.origin}/menus.html`,
  });
});

test('edits text in the clicked field of a page or of the address bar', async () => {
  await start();
  const page = await open('menus.html');
  const fieldSelection = (): Promise<(number | null)[]> =>
    page.evaluate(() => {
      const field = document.getElementById('field') as HTMLInputElement;
      return [field.selectionStart, field.selectionEnd];
    });
  const editItems = [en.undo, en.redo, '-', en.cut, en.copy, en.paste, en.selectAll];
  await page.click('#field', { button: 'right' });
  const fieldMenu = await menu(1);
  expectItems(fieldMenu, editItems);
  expect(fieldMenu.disabled).toEqual(expect.arrayContaining([en.undo, en.redo]));
  await page.evaluate(() =>
    (document.getElementById('field') as HTMLInputElement).setSelectionRange(1, 1),
  );
  await choose(en.selectAll);
  await expect.poll(fieldSelection).toEqual([0, 11]);

  const address = browser.shell.getByRole('textbox', { name: 'Address and search bar' });
  const addressSelection = (): Promise<(number | null)[]> =>
    address.evaluate((input: HTMLInputElement) => [
      input.selectionStart,
      input.selectionEnd,
      input.value.length,
    ]);
  await address.click({ button: 'right' });
  expect((await menu(2)).items).toEqual(editItems);
  await page.evaluate(() =>
    (document.getElementById('field') as HTMLInputElement).setSelectionRange(1, 1),
  );
  await address.evaluate((input: HTMLInputElement) => input.setSelectionRange(0, 0));
  await choose(en.selectAll);
  const length = `${server.origin}/menus.html`.length;
  await expect.poll(addressSelection).toEqual([0, length, length]);
  expect(await fieldSelection()).toEqual([1, 1]);
});

test('offers history items on the page and goes back', async () => {
  await start();
  await open('index.html');
  const page = await open('menus.html');
  await page.click('#blank', { button: 'right' });
  expect(await menu(1)).toEqual({
    items: [en.back, en.forward, en.reload],
    disabled: [en.forward],
    options: { sourceType: 'mouse' },
  });
  await choose(en.back);
  await expect.poll(async () => (await tabUrls()).active).toBe(`${server.origin}/index.html`);
});

test('opens a menu from the keyboard where Chromium places it', async () => {
  await start();
  await open('menus.html');
  // Not every system has a context menu key, so the browser receives the event Chromium sends.
  const view = await browser.main.evaluate(({ BaseWindow }, url) => {
    const views = BaseWindow.getAllWindows()[0]?.contentView.children ?? [];
    const tab = views.find(
      (child): child is Electron.WebContentsView =>
        'webContents' in child && (child as Electron.WebContentsView).webContents.getURL() === url,
    );
    tab?.webContents.emit(
      'context-menu',
      { preventDefault: () => undefined },
      {
        x: 12,
        y: 34,
        linkURL: '',
        srcURL: '',
        mediaType: 'none',
        hasImageContents: false,
        selectionText: '',
        isEditable: true,
        formControlType: 'input-text',
        dictionarySuggestions: [],
        menuSourceType: 'keyboard',
        frame: null,
        editFlags: {
          canUndo: false,
          canRedo: false,
          canCut: false,
          canCopy: false,
          canPaste: true,
          canSelectAll: true,
        },
      },
    );
    return tab?.getBounds();
  }, `${server.origin}/menus.html`);
  expect(view).toBeDefined();
  expect((await menu(1)).options).toEqual({
    x: (view?.x ?? 0) + 12,
    y: (view?.y ?? 0) + 34,
    sourceType: 'keyboard',
  });
});

test('follows the language of the system', async () => {
  await start(['--lang=de']);
  const page = await open('menus.html');
  await page.click('#link', { button: 'right' });
  // German has no title case, so its texts are the same on every system.
  expectItems(await menu(1), ['Link in neuem &Tab öffnen', '&Link-Adresse kopieren']);
  await page.click('#blank', { button: 'right' });
  expect((await menu(2)).items).toEqual(['&Zurück', '&Vorwärts', '&Neu laden']);
});
