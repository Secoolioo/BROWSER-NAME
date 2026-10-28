import type { App, Session, WebContents } from 'electron';
import type { Logger } from '../../kernel/logging/logger.ts';
import { originOf } from './ipc-gate.ts';

/** Permissions that are never granted, not even after a prompt. */
const blockedPermissions = new Set([
  'local-network',
  'loopback-network',
  'local-fonts',
  'window-management',
  'idle-detection',
  'sensors',
]);

/**
 * Decides about a permission request. Until the permission prompt exists, every request is
 * denied. Electron grants everything by default, so this handler must be installed on
 * every session.
 */
export type PermissionDecider = (permission: string, requestingUrl: string) => boolean;

/** Denies every permission. */
export const denyAllPermissions: PermissionDecider = () => false;

/**
 * Hardens a session: permission requests and checks go through the decider, device
 * access is denied and spellchecking is switched off on Windows and Linux, because it
 * would download dictionaries from a third-party server.
 * @param session - Any session.
 * @param decide - Permission decisions; blocked permissions are refused before it is asked.
 */
export function hardenSession(
  session: Session,
  decide: PermissionDecider = denyAllPermissions,
): void {
  session.setPermissionRequestHandler((_contents, permission, callback, details) => {
    callback(!blockedPermissions.has(permission) && decide(permission, details.requestingUrl));
  });
  session.setPermissionCheckHandler(
    (_contents, permission, requestingOrigin) =>
      !blockedPermissions.has(permission) && decide(permission, requestingOrigin),
  );
  session.setDevicePermissionHandler(() => false);
  session.setDisplayMediaRequestHandler((_request, callback) => callback({}));
  if (process.platform !== 'darwin') {
    session.setSpellCheckerEnabled(false);
    session.setSpellCheckerDictionaryDownloadURL('https://0.0.0.0/');
  }
}

/** Options for {@link guardWebContents}. */
export interface WebContentsGuardOptions {
  /** Tells whether a `WebContents` belongs to the browser's own UI. */
  readonly isInternal: (contents: WebContents) => boolean;
  /** Opens a URL that a page wanted to open in a new window as a new tab instead. */
  readonly openInTab: (url: string, opener: WebContents) => void;
  readonly logger: Logger;
}

/**
 * Applies navigation and window guards to every `WebContents` that is created:
 * - `<webview>` is never attached.
 * - Pages cannot open free windows; requests become tabs.
 * - The browser's own views never leave their `app://` origin.
 * - Web content never navigates to `app://`.
 * @param app - The Electron app.
 * @param options - Callbacks into the window layer.
 */
export function guardWebContents(app: App, options: WebContentsGuardOptions): void {
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-attach-webview', (event) => event.preventDefault());
    contents.setWindowOpenHandler(({ url }) => {
      if (!options.isInternal(contents) && /^https?:/i.test(url)) {
        options.openInTab(url, contents);
      }
      return { action: 'deny' };
    });
    const guard = (event: { preventDefault(): void }, url: string): void => {
      if (options.isInternal(contents)) {
        if (originOf(url) !== originOf(contents.getURL()) && contents.getURL() !== '') {
          event.preventDefault();
          options.logger.warn('Blocked navigation of an internal view', { url });
        }
      } else if (/^app:/i.test(url)) {
        event.preventDefault();
        options.logger.warn('Blocked navigation of web content to an internal page', { url });
      }
    };
    contents.on('will-navigate', (event) => guard(event, event.url));
    contents.on('will-redirect', (event) => guard(event, event.url));
    contents.on('will-frame-navigate', (event) => {
      if (!options.isInternal(contents) && /^app:/i.test(event.url)) {
        event.preventDefault();
      }
    });
  });
  app.on('select-client-certificate', (event, _contents, _url, _list, callback) => {
    // Never pick a client certificate automatically; the selection UI arrives later.
    event.preventDefault();
    callback();
  });
}

/**
 * Builds a user agent without the app and Electron tokens, so sites see a plain Chromium.
 * @param userAgent - The default user agent.
 */
export function cleanUserAgent(userAgent: string): string {
  return userAgent
    .replace(/\s+Electron\/\S+/g, '')
    .replace(/\s+[A-Za-z][\w-]*\/\d+(?:\.\d+)*(?=\s+Chrome\/)/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
