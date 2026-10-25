# 0018. Content blocker engine

## Status

Accepted

## Date

2026-10-25

## Context

The `content-blocker` module (M2, see the [roadmap](../roadmap.md)) blocks ads and trackers on the network level and hides page elements through cosmetic filters. It can be switched off per site, receives its filter lists through a signed feed, and adds malware and phishing protection with an interstitial page, because Electron has no Safe Browsing.

Electron's extension support is a subset of Chrome's: there is no `declarativeNetRequest`, so the common blocker extensions cannot run as intended. Electron's `webRequest` API accepts only one listener per event and session; a second listener replaces the first. Lampo is designed to route all requests through one `RequestPipeline` for policy URL filters, HTTPS-First and permissions ([security](../architecture/security.md)).

`@ghostery/adblocker` is a filter engine in plain JavaScript under MPL-2.0. Its ready-made Electron wrapper has gaps: cosmetic filtering only in the top frame, no matching of main-frame requests, `$removeparam` is ignored, it overwrites other `webRequest` listeners, and it loads filter lists without signatures.

## Decision

Lampo uses the `@ghostery/adblocker` 2.20 engine behind its own request pipeline and its own frame preload, not the Electron wrapper.

- **Network filtering:** the blocker is an `IRequestInterceptor` in the kernel's `RequestPipeline`, which owns the single `webRequest` listener per session. The order is policy URL filter, HTTPS upgrade, blocker, permissions. Main-frame requests are matched as well, and `$removeparam` rules are applied.
- **Cosmetic filtering:** a dedicated frame preload, registered only while the module is active, runs in an isolated world in every frame, including subframes. It receives the cosmetic rules for its frame over a validated IPC contract ([ADR 0007](0007-ipc-contracts-and-validation.md)) and applies them. It is the only Lampo script that runs in every web frame, so it stays minimal.
- **Signed filter feed:** CI downloads the filter lists, builds and serializes the engine, signs the result with Ed25519 in the same way as the update feed ([ADR 0014](0014-update-architecture-with-signed-feed.md)) and publishes it on Pages. The browser verifies the signature before it loads the engine and never fetches lists from third-party hosts at runtime. The feed is a documented outgoing connection that a policy can redirect or disable.
- **Malware and phishing protection:** main-frame requests are checked against signed lists (the uBlock Origin badware list, URLhaus under CC0 and phishing-filter under CC BY-SA 4.0) and blocked with an interstitial page.
- **List licensing:** filter lists keep their own licenses, including GPL and CC BY-SA. The lists and the engine data built from them are distributed as separate data files with the license notice of every list, never compiled into Lampo's source code ([ADR 0019](0019-license.md)).
- **Control:** a per-site switch in the UI, the `ContentBlockerEnabled` policy that follows the `<Module>Enabled` pattern of every optional module ([ADR 0010](0010-module-system-and-lazy-loading.md)), and the safe mode, which starts without optional modules.
- **Cost:** the runtime cost per request is measured by the performance harness and must stay within the budgets of [ADR 0017](0017-performance-budgets-in-ci.md).

## Consequences

Positive:

- Blocking does not depend on extension support, which only arrives in M4.
- Main-frame and subframe coverage, `$removeparam` and signed lists close the gaps of the ready-made wrapper.
- The engine is plain JavaScript: no native module and no rebuild per architecture or Electron ABI.
- One pipeline keeps blocking, HTTPS-First and policy filters from replacing each other's listeners.
- The browser loads a prebuilt, verified engine instead of downloading and parsing raw lists itself.
- The engine's license matches Lampo's own.

Negative:

- The frame preload runs in every web frame while the module is active; it needs the same review as other security-relevant code.
- Lampo owns the integration code and must follow changes in the engine's API.
- Filter updates depend on CI and the Pages deployment; if they stall, the lists age.
- Lists under GPL and CC BY-SA need correct attribution in every feed.
- The per-request matching cost adds to navigation latency and has to be watched in the budgets.

## Alternatives considered

- **`@ghostery/adblocker-electron` as is:** cosmetics only in the top frame, no main-frame matching, no `$removeparam`, conflicting `webRequest` listeners and unsigned lists.
- **adblock-rs:** a native Rust engine that needs builds per architecture and Electron ABI, or a WebAssembly build with its own integration work.
- **uBlock Origin Lite:** a Manifest V3 extension built on `declarativeNetRequest`, which Electron does not provide.
- **uBlock Origin as an extension:** relies on extension APIs that Electron's extension support lacks and would tie the blocker to M4.
- **Domain blocklists only:** no cosmetic filtering and no rules below the host level.
