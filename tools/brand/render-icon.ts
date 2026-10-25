/**
 * Renders `assets/brand/app-icon.svg` to `app/build/icon.png` (1024 × 1024 px, transparent),
 * which electron-builder turns into the icons of every package. Run it after changing the
 * SVG; it uses the Chromium of the app's Playwright:
 *
 *   pnpm --filter app exec playwright install chromium
 *   node tools/brand/render-icon.ts
 */
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

interface Page {
  goto(url: string): Promise<unknown>;
  screenshot(options: { path: string; omitBackground: boolean }): Promise<unknown>;
}
interface Playwright {
  chromium: {
    launch(): Promise<{
      newPage(options: { viewport: { width: number; height: number } }): Promise<Page>;
      close(): Promise<void>;
    }>;
  };
}

const root = resolve(import.meta.dirname, '../..');
const size = 1024;
const appRequire = createRequire(join(root, 'app/package.json'));
const { chromium } = appRequire('@playwright/test') as Playwright;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: size, height: size } });
await page.goto(pathToFileURL(join(root, 'assets/brand/app-icon.svg')).href);
await page.screenshot({ path: join(root, 'app/build/icon.png'), omitBackground: true });
await browser.close();
console.log('Wrote app/build/icon.png');
