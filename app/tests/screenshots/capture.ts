/**
 * Takes the screenshots for the website and the release from the real browser. The test
 * build, which differs from the shipped package only in the inspector fuse, shows the
 * architecture overview of the project website in light and dark mode. It runs on Linux under Xvfb at twice the scale,
 * and ImageMagick captures the window from the X display, so the images show exactly what
 * the screen shows.
 *
 * Usage: E2E_APP=<test build> xvfb-run -s '-screen 0 3000x2000x24 -nocursor' \
 *   node tests/screenshots/capture.ts <built website> <output folder>
 * Writes `screenshot-light.png` and `screenshot-dark.png`.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, resolve } from 'node:path';
import { launch, waitForPage } from '../e2e/harness.ts';

const scale = 2;
const types: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

const [siteArgument, outArgument] = process.argv.slice(2);
if (siteArgument === undefined || outArgument === undefined) {
  throw new Error('Usage: node tests/screenshots/capture.ts <built website> <output folder>');
}
const site = resolve(siteArgument);
const out = resolve(outArgument);
mkdirSync(out, { recursive: true });
const brand = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../../../brand.json'), 'utf8'),
) as { website: string };
const base = new URL(brand.website).pathname;

// The site is served below the same path as on GitHub Pages.
const server = createServer((request, response) => {
  const path = decodeURIComponent(new URL(request.url ?? '/', 'http://x').pathname);
  let file = path.startsWith(base) ? join(site, path.slice(base.length)) : '';
  if (file !== '' && existsSync(file) && statSync(file).isDirectory())
    file = join(file, 'index.html');
  if (file === '' || !file.startsWith(site) || !existsSync(file)) {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' });
  response.end(readFileSync(file));
});
await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
const address = server.address();
const origin =
  typeof address === 'object' && address !== null ? `http://127.0.0.1:${address.port}` : '';

// Under Xvfb the system has no color scheme, so the shell and the page get it through the
// DevTools protocol; both render with their own styles for that scheme.
for (const theme of ['light', 'dark'] as const) {
  const browser = await launch([`--force-device-scale-factor=${scale}`]);
  try {
    const addressBar = browser.shell.getByRole('textbox', { name: 'Address and search bar' });
    await addressBar.fill(`${origin}${base}docs/architecture/overview/`);
    await addressBar.press('Enter');
    const page = await waitForPage(browser, (url) => url.startsWith(origin));
    await page.waitForLoadState('networkidle');
    for (const view of [browser.shell, page]) await view.emulateMedia({ colorScheme: theme });
    // Fonts settle and the diagrams are drawn after the load event.
    await page.locator('.diagram').first().waitFor();
    await new Promise((done) => setTimeout(done, 1000));
    const bounds = await browser.main.evaluate(({ BaseWindow }) =>
      BaseWindow.getAllWindows()[0]?.getContentBounds(),
    );
    if (bounds === undefined) throw new Error('The browser has no window');
    const crop = `${bounds.width * scale}x${bounds.height * scale}+${bounds.x * scale}+${bounds.y * scale}`;
    const file = join(out, `screenshot-${theme}.png`);
    const result = spawnSync('import', ['-window', 'root', '-crop', crop, '+repage', file]);
    if (result.status !== 0) throw new Error(`Capturing failed: ${String(result.stderr)}`);
    process.stdout.write(`Wrote ${file}\n`);
  } finally {
    await browser.close();
  }
}
server.close();
