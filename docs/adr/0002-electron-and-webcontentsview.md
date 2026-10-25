# 0002. Electron and the WebContentsView model

## Status

Accepted

## Date

2026-10-25

## Context

Lampo embeds Chromium instead of building or forking an engine, which is an explicit non-goal. The embedding decides how current the engine stays, how quickly security fixes reach users, which package formats and update mechanisms are available, and which language the team works in. The team is three maintainers who work in TypeScript.

As of 2026-10-25, Electron 45.0.0 ships Chromium 156.0.8078.48, Node 24.22.0 and V8 15.6, and appeared one day after Chrome 156 reached the stable channel. Electron supports its three latest majors (45, 44 and 43), publishes a new major every eight weeks (Electron 46 with Chromium 160 is expected around January 2027) and ships patch releases two to three times per week per supported line.

Six options were scored from 1 to 5 per criterion; the weight of each criterion is given in percent.

| Criterion (weight)                                | Electron | castLabs ECS | CEF (C++/Rust host) | Qt WebEngine | Tauri 2 (system web views) | Tauri 3 + CEF |
| ------------------------------------------------- | -------- | ------------ | ------------------- | ------------ | -------------------------- | ------------- |
| Web compatibility (20)                            | 4        | 4            | 5                   | 2            | 2                          | 5             |
| Security currency (15)                            | 5        | 3            | 4                   | 2            | 3                          | 1             |
| Memory and CPU (10)                               | 3        | 3            | 3                   | 3            | 4                          | 3             |
| Start-up time (5)                                 | 4        | 4            | 4                   | 3            | 3                          | 3             |
| Size (5)                                          | 2        | 2            | 2                   | 2            | 5                          | 2             |
| Packaging incl. AppImage, deb, rpm, MSI, dmg (10) | 5        | 5            | 2                   | 3            | 4                          | 3             |
| Auto-update (10)                                  | 4        | 4            | 2                   | 1            | 4                          | 4             |
| Extensions (5)                                    | 2        | 2            | 4                   | 2            | 1                          | 3             |
| Codecs and DRM (5)                                | 3        | 5            | 2                   | 2            | 2                          | 2             |
| Maintainability and team fit (15)                 | 5        | 4            | 2                   | 3            | 3                          | 2             |
| **Weighted total (max 5.00)**                     | **4.05** | 3.70         | 3.20                | 2.30         | 3.05                       | 2.95          |

Key observations behind the scores:

- Electron trails Chrome stable by about a day and patches several times per week; castLabs ECS builds follow monthly. Qt WebEngine is based on Chromium 140, 16 milestones behind. Tauri 3 with CEF is in alpha and runs without a sandbox on Windows.
- Electron's ecosystem covers every target format with electron-builder 26.18 ([ADR 0003](0003-packaging-with-electron-builder.md)) and updates with electron-updater 6.8 ([ADR 0014](0014-update-architecture-with-signed-feed.md)); with CEF, all packaging and updating would be custom work.
- Electron supports H.264, AAC and hardware HEVC decoding but not Widevine; ECS adds Widevine with free VMP signing.
- Electron offers only a subset of extension APIs (no `chrome.action`, no declarativeNetRequest); CEF supports Chrome-style extensions.
- Tauri 2 depends on three different system engines, WebKitGTK has known compatibility problems, and WKWebView offers no HTTP interception.

## Decision

Lampo is built on upstream Electron. It always tracks the latest stable major, currently 45.x, and upgrades within two to four weeks of each new major. Security fixes follow the response times in [WORKFLOW.md](../maintainers/WORKFLOW.md).

Each window is a `BaseWindow` that hosts `WebContentsView`s: one shell view for the browser UI, one overlay view for menus, the command palette, omnibox suggestions and permission prompts, and one view per tab. The overlay view is created lazily and attached only while something is open. A tab is a domain entity, not a view: the view is created when the tab is activated and destroyed when it sleeps, while its navigation entries are kept. Tab views run sandboxed with site isolation and without a preload; the only planned exception is the content blocker's frame preload in M2 ([ADR 0018](0018-content-blocker-engine.md)). Neither the `<webview>` tag nor `BrowserView` is used; `will-attach-webview` is always denied. Electron APIs are wrapped behind facades in `platform/electron`, so upgrades stay local.

**Plan B:** if upstream Electron becomes unworkable, Lampo moves to CEF, either through cef-rs or through Tauri 3 with CEF once that is stable and sandboxed on Windows.

**DRM:** an optional build flavor based on castLabs ECS is evaluated in M4, after the Widevine licensing terms are clarified with castLabs. It would ship unmodified ECS binaries with the permitted fuses only. The main channel stays on upstream Electron to keep the fastest security cadence.

## Consequences

Positive:

- Chromium security fixes are expected to reach users within days of their upstream release.
- The whole browser, from kernel to UI, is written in TypeScript, which fits the team.
- `WebContentsView` is the embedding model the Electron project recommends, and views can be moved between windows without a reload, which drag and drop and tear-off rely on.

Negative:

- Electron accounts for about 97 % of the package size (zip archives of about 121 to 158 MB) and the fixed processes need about 220 to 250 MB of resident memory; [ADR 0017](0017-performance-budgets-in-ci.md) measures against a bare Electron baseline for this reason.
- Widevine is unavailable on the main channel, and extensions are limited until M4.
- Chrome services such as Safe Browsing, HTTPS upgrades, print preview and the spell-check dictionary download are missing and need Lampo's own implementations.
- Google sign-in needs user agent adjustments and a manual check after every Electron major.
- Known view quirks (overlay focus and z-order, black transparency on Wayland, focus theft by background tabs) need workarounds and regression tests on every upgrade.
- Majors arrive every eight weeks with breaking changes; a weekly CI job against the next Electron beta is expected to surface them early.

## Alternatives considered

- **castLabs ECS as the main build:** Widevine included, but monthly builds lag behind upstream security fixes.
- **CEF with a C++ or Rust host:** best web and extension compatibility, but packaging, updates and the sandbox bootstrap would all be custom work; kept as Plan B.
- **Qt WebEngine:** 16 Chromium milestones behind and infrequent security cherry-picks.
- **Tauri 2 with system web views:** small packages, but three engines with different behavior and no HTTP interception in WKWebView.
- **Tauri 3 with CEF:** promising, but in alpha and without a sandbox on Windows.
- **The `<webview>` tag or `BrowserView`:** `<webview>` is discouraged by the Electron project and `BrowserView` is deprecated.
