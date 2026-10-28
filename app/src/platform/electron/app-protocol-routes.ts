import { join } from 'node:path';

/** The browser's internal scheme. */
export const appScheme = 'app';

/**
 * Content Security Policy of every internal page. Scripts and styles only come from the
 * page's own origin, nothing can be framed or posted, and DOM sinks require Trusted Types.
 */
export const appContentSecurityPolicy = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "require-trusted-types-for 'script'",
  'trusted-types lit-html',
].join('; ');

/** Response headers of every internal page and file. */
export const appResponseHeaders: Readonly<Record<string, string>> = {
  'content-security-policy': appContentSecurityPolicy,
  'x-content-type-options': 'nosniff',
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
  'cache-control': 'no-cache',
};

/** A route for `protocol.registerSource`: matching URLs are served from a directory. */
export interface AppSourceRoute {
  readonly match: { readonly host: string; readonly path?: string };
  readonly source: {
    readonly type: 'directory';
    readonly root: string;
    readonly index?: string;
    readonly headers: Record<string, string>;
  };
}

/**
 * Maps every internal host to its folder of the renderer build. Paths below `/assets/`
 * of every host come from the shared asset folder, because the bundler writes one. The
 * files are streamed without the main thread, so internal pages load at full speed even
 * while the main process is busy; paths that leave a folder are never served.
 * @param root - Directory that contains one folder per host and the `assets` folder.
 * @param hosts - Hosts that exist, such as `shell`.
 */
export function appSourceRoutes(root: string, hosts: Iterable<string>): AppSourceRoute[] {
  return [...hosts].flatMap((host) => [
    {
      match: { host, path: '/assets/' },
      source: {
        type: 'directory' as const,
        root: join(root, 'assets'),
        index: '',
        headers: { ...appResponseHeaders },
      },
    },
    {
      match: { host },
      source: {
        type: 'directory' as const,
        root: join(root, host),
        headers: { ...appResponseHeaders },
      },
    },
  ]);
}
