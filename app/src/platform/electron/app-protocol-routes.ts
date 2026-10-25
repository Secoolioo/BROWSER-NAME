import { extname, join, normalize, sep } from 'node:path';

/** The browser's internal scheme. */
export const appScheme = 'app';

/** Result of resolving an `app://` request to a file. */
export type AppRoute =
  | { readonly kind: 'file'; readonly path: string; readonly contentType: string }
  | { readonly kind: 'error'; readonly status: 403 | 404 | 405 };

const contentTypes: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
};

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

/**
 * Maps an `app://<host>/<path>` request to a file of that host's directory. Paths below
 * `/assets/` are shared by all hosts, because the bundler writes one asset directory.
 * Unknown hosts, hidden files and paths that leave the directory are refused.
 * @param method - HTTP method of the request.
 * @param url - The request URL.
 * @param root - Directory that contains one folder per host.
 * @param hosts - Hosts that exist, such as `shell` and `settings`.
 */
export function resolveAppRoute(
  method: string,
  url: string,
  root: string,
  hosts: ReadonlySet<string>,
): AppRoute {
  if (method !== 'GET' && method !== 'HEAD') {
    return { kind: 'error', status: 405 };
  }
  const match = /^app:\/\/([a-z0-9-]+)(\/[^?#]*)?/i.exec(url);
  const host = match?.[1]?.toLowerCase();
  if (host === undefined || !hosts.has(host)) {
    return { kind: 'error', status: 404 };
  }
  let path: string;
  try {
    path = decodeURIComponent(match?.[2] ?? '/');
  } catch {
    return { kind: 'error', status: 404 };
  }
  if (path.includes('\0') || /(^|\/)\.[^/]/.test(path)) {
    return { kind: 'error', status: 403 };
  }
  const shared = path.startsWith('/assets/');
  const base = shared ? join(root, 'assets') : join(root, host);
  const relative = shared ? path.slice('/assets'.length) : path;
  const file = normalize(join(base, relative.endsWith('/') ? `${relative}index.html` : relative));
  if (file !== base && !file.startsWith(base + sep)) {
    return { kind: 'error', status: 403 };
  }
  const contentType = contentTypes[extname(file).toLowerCase()];
  return contentType === undefined
    ? { kind: 'error', status: 404 }
    : { kind: 'file', path: file, contentType };
}
