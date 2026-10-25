import { expect, test } from '@playwright/test';
import {
  FixtureServer,
  launch,
  pressNative,
  shellState,
  waitForPage,
  type Browser,
} from './harness.ts';

const server = new FixtureServer();
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
  const page = await waitForPage(browser.app, (url) => url.endsWith('/index.html'));
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

test('keeps web content away from internal APIs and pages', async () => {
  await navigate(`${server.origin}/probe.html`);
  const page = await waitForPage(browser.app, (url) => url.endsWith('/probe.html'));
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
  const page = await waitForPage(browser.app, (url) => url.endsWith('/index.html'));
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
  const page = await waitForPage(browser.app, (url) => url.endsWith('/index.html'));
  await page.evaluate((url) => window.open(url), `${server.origin}/second.html`);
  await expect(browser.shell.getByRole('tab')).toHaveCount(2);
  expect(await browser.app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows().length)).toBe(1);
});
