import { app } from 'electron';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bootstrap } from './bootstrap.ts';

const here = dirname(fileURLToPath(import.meta.url));

bootstrap({
  rendererDir: join(here, '../renderer'),
  shellPreload: join(here, '../preload/shell.cjs'),
  pagePreload: join(here, '../preload/page.cjs'),
  devShellUrl:
    !app.isPackaged && process.env['ELECTRON_RENDERER_URL'] !== undefined
      ? `${process.env['ELECTRON_RENDERER_URL']}/shell/`
      : undefined,
}).catch((error: unknown) => {
  // The logger may not exist yet; the error must still be visible.
  process.stderr.write(`Start failed: ${String(error)}\n`);
  app.exit(1);
});
