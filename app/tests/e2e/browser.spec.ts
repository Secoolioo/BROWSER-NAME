import { expect, test } from '@playwright/test';
import {
  FixtureServer,
  clickHistoryButton,
  launch,
  pressNative,
  shellState,
  waitForPage,
  type Browser,
} from './harness.ts';

const server = new FixtureServer();
const mac = process.platform === 'darwin';
let browser: Browser;

test.beforeAll(async () => {
  await server.start();
});
test.afterAll(async () => {
  await server.stop();
});
test.beforeEach(async () => {
  browser = await launch();
});
test.afterEach(async () => {
  await browser.close();
});

async function navigate(input: string): Promise<void> {
  const address = browser.shell.getByRole('textbox', { name: 'Address and search bar' });
  await address.fill(input);
  await address.press('Enter');
}

async function activeTab(): Promise<{ index: number; title: string | undefined }> {
  const state = await shellState(browser.shell);
  const index = state.tabs.findIndex((tab) => tab.id === state.activeTabId);
  return { index, title: state.tabs[index]?.title };
}

test('shows the shell with one tab and an address bar', async () => {
  await expect(browser.shell.getByRole('tab')).toHaveCount(1);
  await expect(
    browser.shell.getByRole('textbox', { name: 'Address and search bar' }),
  ).toBeVisible();
  const csp = await browser.shell.evaluate(() =>
    fetch(location.href).then((r) => r.headers.get('content-security-policy')),
  );
  expect(csp).toContain("default-src 'none'");
});

test('navigates from the address bar and updates the tab', async () => {
  await navigate(`${server.origin}/index.html`);
  const page = await waitForPage(browser, (url) => url.endsWith('/index.html'));
  await expect(page).toHaveTitle('Fixture home');
  await expect(browser.shell.getByRole('tab', { name: 'Fixture home' })).toBeVisible();
  await page.click('#second');
  await expect.poll(async () => (await shellState(browser.shell)).tabs[0]?.canGoBack).toBe(true);
  await expect(browser.shell.getByRole('button', { name: 'Back' })).toBeEnabled();
  await browser.shell.getByRole('button', { name: 'Back' }).click();
  await expect
    .poll(async () => (await shellState(browser.shell)).tabs[0]?.title)
    .toBe('Fixture home');
});

test('opens, closes and reopens tabs with keyboard shortcuts', async () => {
  await navigate(`${server.origin}/index.html`);
  await expect(browser.shell.getByRole('tab', { name: 'Fixture home' })).toBeVisible();
  await pressNative(browser, 'T', ['primary']);
  await expect(browser.shell.getByRole('tab')).toHaveCount(2);
  await pressNative(browser, 'W', ['primary']);
  await expect(browser.shell.getByRole('tab')).toHaveCount(1);
  await pressNative(browser, 'W', ['primary']);
  await expect
    .poll(async () => (await shellState(browser.shell)).tabs.map((t) => t.url))
    .toEqual(['about:blank']);
  await pressNative(browser, 'T', ['primary', 'shift']);
  await expect
    .poll(async () => (await shellState(browser.shell)).tabs.map((t) => t.url))
    .toContain(`${server.origin}/index.html`);
});

test('goes back and forward with the shortcuts of each system', async () => {
  await navigate(`${server.origin}/index.html`);
  const page = await waitForPage(browser, (url) => url.endsWith('/index.html'));
  await page.click('#second');
  await expect.poll(async () => (await activeTab()).title).toBe('Fixture second');
  // Cmd+[ and Cmd+] on macOS, Alt+Left and Alt+Right elsewhere; in the page, then the shell.
  await pressNative(browser, mac ? '[' : 'Left', [mac ? 'primary' : 'alt'], server.origin);
  await expect.poll(async () => (await activeTab()).title).toBe('Fixture home');
  await pressNative(browser, mac ? ']' : 'Right', [mac ? 'primary' : 'alt']);
  await expect.poll(async () => (await activeTab()).title).toBe('Fixture second');
});

test('switches tabs with the shortcuts of each system', async () => {
  await navigate(`${server.origin}/index.html`);
  await expect(browser.shell.getByRole('tab', { name: 'Fixture home' })).toBeVisible();
  await pressNative(browser, 'T', ['primary']);
  await expect.poll(async () => (await activeTab()).index).toBe(1);
  await pressNative(browser, 'Tab', ['control', 'shift']);
  await expect.poll(async () => (await activeTab()).index).toBe(0);
  // Cmd+Option+Right on macOS, Ctrl+Page Down elsewhere, pressed in the page.
  if (mac) await pressNative(browser, 'Right', ['primary', 'alt'], server.origin);
  else await pressNative(browser, 'PageDown', ['control'], server.origin);
  await expect.poll(async () => (await activeTab()).index).toBe(1);
  // Cmd+Shift+[ on macOS, Ctrl+Page Up elsewhere.
  if (mac) await pressNative(browser, '[', ['primary', 'shift']);
  else await pressNative(browser, 'PageUp', ['control']);
  await expect.poll(async () => (await activeTab()).index).toBe(0);
  await pressNative(browser, 'Tab', ['control']);
  await expect.poll(async () => (await activeTab()).index).toBe(1);
});

test("follows the mouse's back and forward buttons over the page and the toolbar", async () => {
  await navigate(`${server.origin}/index.html`);
  const page = await waitForPage(browser, (url) => url.endsWith('/index.html'));
  await page.click('#second');
  await expect.poll(async () => (await activeTab()).title).toBe('Fixture second');
  await navigate(`${server.origin}/probe.html`);
  await expect.poll(async () => (await activeTab()).title).toBe('Fixture probe');
  // One page per click: Chromium handles the button over the page, the shell over the toolbar.
  await clickHistoryButton(page, 'back', { x: 200, y: 200 });
  await expect.poll(async () => (await activeTab()).title).toBe('Fixture second');
  await clickHistoryButton(browser.shell, 'back', { x: 900, y: 12 });
  await expect.poll(async () => (await activeTab()).title).toBe('Fixture home');
  await clickHistoryButton(browser.shell, 'forward', { x: 900, y: 12 });
  await expect.poll(async () => (await activeTab()).title).toBe('Fixture second');
});

test('keeps web content away from internal APIs and pages', async () => {
  await navigate(`${server.origin}/probe.html`);
  const page = await waitForPage(browser, (url) => url.endsWith('/probe.html'));
  expect(await page.evaluate(() => 'bridge' in window)).toBe(false);
  const status = await page.evaluate(() =>
    fetch('app://shell/').then(
      (r) => r.status,
      () => 'blocked',
    ),
  );
  expect(status).not.toBe(200);
  await page.evaluate(() => document.getElementById('internal')?.click());
  await page.waitForTimeout(500);
  expect(page.url()).toBe(`${server.origin}/probe.html`);
});

test('denies permissions by default', async () => {
  await navigate(`${server.origin}/index.html`);
  const page = await waitForPage(browser, (url) => url.endsWith('/index.html'));
  expect(await page.evaluate(() => Notification.requestPermission())).toBe('denied');
  const geolocation = await page.evaluate(
    () =>
      new Promise((done) =>
        navigator.geolocation.getCurrentPosition(
          () => done('granted'),
          (e) => done(e.code),
        ),
      ),
  );
  expect(geolocation).toBe(1);
});

test('opens new windows from pages as tabs', async () => {
  await navigate(`${server.origin}/index.html`);
  const page = await waitForPage(browser, (url) => url.endsWith('/index.html'));
  await page.evaluate((url) => window.open(url), `${server.origin}/second.html`);
  await expect(browser.shell.getByRole('tab')).toHaveCount(2);
  expect(await browser.main.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows().length)).toBe(
    1,
  );
});
