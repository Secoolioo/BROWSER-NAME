import { app, BaseWindow, shell, WebContentsView } from 'electron';
import { spawn } from 'node:child_process';
import { brand } from '../shared/brand.ts';
import { InstallSandboxFix, OpenPackagesPage } from '../shared/ipc/sandbox-help-contracts.ts';
import type { Logger } from '../kernel/logging/logger.ts';
import type { IpcGate } from '../platform/electron/ipc-gate.ts';
import type { IpcRouter } from '../platform/electron/ipc-router.ts';
import { windowBackground } from './window-background.ts';

/**
 * AppArmor profile that allows user namespaces for the AppImage's mounted binary, so the
 * Chromium sandbox works on systems that restrict unprivileged user namespaces.
 */
export function appImageProfile(slug: string): string {
  return [
    'abi <abi/4.0>,',
    'include <tunables/global>',
    '',
    `profile ${slug}-appimage /tmp/.mount_*/${slug} flags=(unconfined) {`,
    '  userns,',
    `  include if exists <local/${slug}-appimage>`,
    '}',
    '',
  ].join('\n');
}

/**
 * Shows the sandbox help page instead of the browser. The AppImage launcher starts this
 * mode when the Chromium sandbox cannot work, so no web content is ever loaded without it.
 * @param options - Where the page and its preload are, and the IPC plumbing.
 */
export function showSandboxHelp(options: {
  readonly url: string;
  readonly origin: string;
  readonly preload: string;
  readonly partition: string;
  readonly gate: IpcGate;
  readonly router: IpcRouter;
  readonly logger: Logger;
}): WebContentsView {
  const window = new BaseWindow({
    width: 640,
    height: 560,
    resizable: false,
    show: false,
    backgroundColor: windowBackground(),
  });
  const view = new WebContentsView({
    webPreferences: {
      preload: options.preload,
      partition: options.partition,
      additionalArguments: ['--bridge-scope=sandboxHelp'],
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  window.contentView.addChildView(view);
  const resize = (): void => {
    const { width, height } = window.getContentBounds();
    view.setBounds({ x: 0, y: 0, width, height });
  };
  window.on('resize', resize);
  resize();
  options.gate.registerView(view.webContents.id, {
    origin: options.origin,
    capabilities: new Set(['page:sandbox-help']),
  });
  options.router.handle(InstallSandboxFix, async () => {
    const file = `/etc/apparmor.d/${brand.slug}-appimage`;
    const ok = await new Promise<boolean>((resolve) => {
      const child = spawn(
        'pkexec',
        ['sh', '-c', `cat > '${file}' && apparmor_parser -r '${file}'`],
        {
          stdio: ['pipe', 'ignore', 'ignore'],
        },
      );
      child.on('error', () => resolve(false));
      child.on('exit', (code) => resolve(code === 0));
      child.stdin.end(appImageProfile(brand.slug));
    });
    options.logger.info('Sandbox fix finished', { ok });
    if (ok) {
      app.relaunch({
        args: process.argv.slice(1).filter((a) => a !== '--no-sandbox' && a !== '--sandbox-help'),
      });
      app.exit(0);
    }
    return { ok };
  });
  options.router.handle(OpenPackagesPage, async () => {
    await shell.openExternal(`${brand.website}download/`);
    return null;
  });
  view.webContents.once('did-finish-load', () => window.show());
  void view.webContents.loadURL(options.url);
  return view;
}
