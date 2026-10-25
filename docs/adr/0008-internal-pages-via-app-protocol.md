# 0008. Internal pages via the `app://` protocol

## Status

Accepted

## Date

2026-10-25

## Validation

The performance harness measured the shell over `protocol.handle`: every request waited for the busy main process, and the shell's HTML response took about 40 ms to arrive. With `protocol.registerSource`, the internal session streams the files without the main thread, which made the shell load about 20 ms faster on Linux (October 2026). The internal session therefore uses `protocol.registerSource` with one route per host, a shared route for the bundler's `/assets/` folder, and the response headers of the Content Security Policy. Web sessions keep a `protocol.handle` handler that answers every `app://` request with 403. Paths that leave a route's folder are never served. The harness checks the start-up budget on every pull request, so a regression of the experimental API would surface at the next Electron upgrade.

## Context

Lampo's own UI is web content: the shell of each window, the overlay, and internal pages such as settings, history, downloads, the theme editor, diagnostics and the new tab page. These pages must load quickly at start-up, must have their own origin so that the main process can tell them apart from web content, and must be unreachable from websites. Loading them from `file://` gives no distinct origin, shares privileges with every local file and cannot use Chromium's code cache in the same way as a standard scheme.

## Decision

Lampo serves all of its own UI from a privileged custom scheme, `app://`.

- The scheme is registered with `protocol.registerSchemesAsPrivileged` before the app is ready, with the privileges `standard`, `secure`, `supportFetchAPI` and `codeCache`.
- Requests are answered through `protocol.handle`, which serves files from the packaged app archive only. The handler is registered on every session, including sessions created later for isolated workspaces and private windows (`session-created`).
- `protocol.registerSource`, new and experimental in Electron 45, is evaluated as a way to serve these files without involving the main thread.
- Each surface has its own host. The shell loads from `app://shell`; the overlay has its own host as well, and the internal pages are `app://settings`, `app://history`, `app://downloads`, `app://theme-editor`, `app://diagnostics` and `app://newtab`. Settings support deep links such as `app://settings/#tabs.position`.
- Internal pages open as normal tabs with a capability-scoped preload; each page receives only the IPC channels it needs ([ADR 0007](0007-ipc-contracts-and-validation.md)).
- All `app://` pages use a strict Content Security Policy and Trusted Types. Views load them with `v8CacheOptions: 'bypassHeatCheck'` so the code cache is created on the first start and used from the next start on.
- Shell, overlay and internal pages may never navigate away from `app://`; `will-navigate` and `will-redirect` enforce this.
- Web tabs may not navigate to, embed or load any `app://` resource.

The scheme registration and the navigation guards belong to the kernel, not to a module. They cannot be turned off, not by a setting, a policy, a disabled module or safe mode. Tests cover "web tab opens `app://settings` and is blocked" and "module disabled, access still denied".

## Consequences

Positive:

- Internal pages have a clear origin, which makes sender checks in the IPC router reliable.
- The `codeCache` privilege and the bypassed heat check are expected to shorten shell start-up after the first launch ([ADR 0017](0017-performance-budgets-in-ci.md)).
- `file://` needs no extra privileges, so the `grantFileProtocolExtraPrivileges` fuse can stay off ([ADR 0003](0003-packaging-with-electron-builder.md)).
- The same mechanism serves every internal page, so new pages need no new loading infrastructure.

Negative:

- Every new session needs the handler, the permission handlers and the guards; forgetting one would open a gap, so the registration is centralized in the kernel and covered by tests.
- `protocol.registerSource` is experimental and may change between Electron majors; until it is proven, files are served by the main process.
- A strict CSP with Trusted Types rules out libraries that inject HTML strings or evaluate code, which narrows dependency choices for the UI.

## Alternatives considered

- **`file://` pages:** no distinct origin, broad file access and weaker code caching.
- **A local HTTP server:** exposes a port that other local processes can reach, and adds start-up work.
- **`data:` or `blob:` URLs:** no stable origin and no code cache.
- **The deprecated `protocol.registerFileProtocol` family:** replaced by `protocol.handle` in current Electron versions.
