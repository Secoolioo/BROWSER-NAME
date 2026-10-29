# Security and privacy

> **Status:** partly implemented. The Electron hardening baseline exists; the rest of this page is design. See [implementation status](#implementation-status).

Security and privacy are two of Astela's core [principles](principles.md): the Chromium sandbox, process isolation, validated IPC, signed updates and fixed response times for security fixes, with no telemetry and local data. This document covers the hardening of the Electron embedding, network security, the supply chain, response times, documented limits and privacy. To report a vulnerability, follow [SECURITY.md](../../SECURITY.md).

## Electron hardening

Every item in this section is designed to be covered by an automated test.

### Web preferences

- The sandbox is on for every renderer (an Electron default since Electron 20).
- `contextIsolation` is on.
- `nodeIntegration` is `false`.
- `webSecurity` stays on; `allowRunningInsecureContent` and experimental features stay off.
- There is no `<webview>`: `will-attach-webview` is always denied.
- Web tabs have no preload script; the only planned exception is the content blocker's minimal frame preload in M2 (see [IPC](ipc.md)). Feature scripts, such as the reader view, will run only on demand in an isolated world.
- Internal pages get a capability-scoped preload that exposes only the IPC channels they need (see [IPC](ipc.md)).

### Navigation and window guards

- `setWindowOpenHandler` will open new tabs instead of free-floating windows.
- The shell, the overlay and internal pages must never navigate away from `app://`; `will-navigate` and `will-redirect` guards enforce this.
- Web tabs can neither navigate to, embed nor load `app://` pages.
- `shell.openExternal` is limited to allowlisted schemes and requires confirmation.

### Content Security Policy

All `app://` pages use a strict Content Security Policy and Trusted Types. Validation code stays CSP-safe because the schema library does not use `eval` or `new Function`.

### Permission handlers

Electron grants every permission by default (as of October 2026). Astela will therefore install request, check and device permission handlers on **every** session, including sessions created later (`session-created`):

- Default deny, with a prompt per origin; the decision will be stored.
- `local-network`, `loopback-network`, `local-fonts`, `window-management`, `idle-detection` and `sensors` are blocked by default.
- Camera, microphone, location and notifications are denied unless the user consents.

The permission handlers, the navigation and window guards and the `app://` registration belong to the kernel, not to an optional module. They cannot be disabled and will stay in effect with every optional module turned off and in safe mode. Tests will check that a permission stays denied with the `permissions` module disabled and that a web tab cannot open `app://settings`. See [modules](modules.md) for the kernel and module boundaries.

### Certificates

- Client certificates are never selected automatically. The `select-client-certificate` handler will call `preventDefault()` and show a selection UI.
- Certificate errors will show a dedicated interstitial page.
- `setCertificateVerifyProc` never accepts certificates wholesale.

### Fuses

Electron fuses will be set through electron-builder's `electronFuses` option and checked in the package smoke test:

| Fuse                                    | Value   | Effect                                                        |
| --------------------------------------- | ------- | ------------------------------------------------------------- |
| `runAsNode`                             | `false` | The binary cannot be started as a plain Node.js runtime.      |
| `enableCookieEncryption`                | `true`  | The cookie store is encrypted at rest with an OS-managed key. |
| `enableNodeOptionsEnvironmentVariable`  | `false` | `NODE_OPTIONS` is ignored.                                    |
| `enableNodeCliInspectArguments`         | `false` | `--inspect` and related debugging flags are ignored.          |
| `enableEmbeddedAsarIntegrityValidation` | `true`  | The app archive is validated against its embedded hash.       |
| `onlyLoadAppFromAsar`                   | `true`  | The app code is loaded only from the archive.                 |
| `grantFileProtocolExtraPrivileges`      | `false` | `file://` pages get no extra privileges.                      |

- Cookie encryption is enabled from the first release, because turning it on is a one-way change.
- End-to-end tests need the `enableNodeCliInspectArguments` fuse, so they will run on a test build that differs from the shipped package in that one fuse only. The shipped package will be verified by its built-in self-test (`--smoke-test`) and by reading back its fuses (see [testing](testing.md)).

## Process isolation

- Site isolation stays on.
- Web content runs in sandboxed tab views; the browser UI runs in separate shell and overlay views (see [overview](overview.md)).
- Isolated workspaces get their own partition (`persist:ws-<id>`); private windows use an in-memory partition (see [data](data.md)).
- Data access and hashing run in a `utilityProcess`, not in the browser process.
- Every IPC message will be checked for its sender, the sender's capability, its schema and a rate limit (see [IPC](ipc.md)).

## Network security

### HTTPS-First

Chromium's HTTPS upgrades are not available in Electron (as of October 2026), so Astela implements HTTPS-First itself in M1:

- The `RequestPipeline` will upgrade navigations to HTTPS.
- If the upgrade fails, an interstitial will offer "Continue over HTTP", which creates a temporary exception for that host.
- `localhost`, private IP addresses, `.local` hosts and hosts on a policy allowlist are exempt.
- HTTPS-First is on by default.

A strict HTTPS-only mode follows in M2, selectable in the settings and through the `HttpsOnlyMode` policy.

### DNS over HTTPS

Contrary to its documentation, Electron starts with DNS over HTTPS turned off (as of October 2026). Astela will therefore call `configureHostResolver` explicitly:

- Default: `automatic` mode with a list of providers.
- The `DnsOverHttpsMode` policy can switch to `off` or `secure`; `DnsOverHttpsTemplates` sets custom resolver templates (see [enterprise](enterprise.md)).

### Malware and phishing protection

Safe Browsing is not available in Electron (as of October 2026). In M2, Astela will block main-frame navigations to known malicious sites with signed lists and show an interstitial instead. The planned sources are the uBlock Origin badware list, URLhaus (CC0) and phishing-filter (CC BY-SA 4.0).

## User agent

- Astela will remove the app and Electron tokens from the user agent string through `app.userAgentFallback`. The User-Agent Client Hints brand stays "Chromium".
- Google account sign-in (`accounts.google.com`) can reject Electron-based browsers (as of October 2026), so the design includes a user agent override for that host behind a feature flag.
- The override and Google account sign-in will be checked manually after every Electron major upgrade, as part of the [maintainer workflow](../maintainers/WORKFLOW.md).

## Web platform API inventory

An early M1 spike produced an inventory of web platform APIs exposed by the embedded Chromium, measured in the packaged build. Capabilities that depend on Google services are unavailable, because Electron includes neither those services nor Chromium's component updater; the [validation results](validation.md#web-platform-api-inventory) list the details. If a later Electron version exposes an unexpected working capability, the repository owner will decide whether and how to disable it.

## Supply chain

- **Releases:** immutable releases, artifact attestations (`actions/attest`) and a CycloneDX SBOM for every release.
- **Signatures:** `SHA256SUMS` with an Ed25519 signature; GPG for the Linux repositories; operating system code signing once certificates are available (see [updates](updates.md)).
- **Actions:** pinned by commit SHA, enforced with `sha_pinning_required`.
- **Scanners:** CodeQL, osv-scanner, dependency-review, zizmor (blocking), OpenSSF Scorecard and secret scanning with push protection.
- **Dependencies:** pnpm `allowBuilds` limits install scripts to an allowlist; a license check enforces an allowlist of dependency licenses; every new dependency needs a stated reason.
- **Tests:** dedicated security tests will check the `webPreferences` of every created `WebContents`, the fuse state of the packaged binary, the CSP of `app://` pages and the navigation locks of the shell.

### Secrets

- Signing keys (Ed25519, GPG and code signing) and the publishing token are stored only as secrets of the `release` environment, which only `main` may use.
- Branch and pull request workflows never see these secrets, not even through modified workflow code. Pull requests from owner branches are opened in two stages through `workflow_run`, and the token used for that lives in the `automation` environment, also restricted to `main`.
- No private key is ever stored in the repository. The repository owner keeps an encrypted offline backup.

The [maintainer workflow](../maintainers/WORKFLOW.md) describes the environments and the release process.

## Security response times

| Event                                | Target                                                             |
| ------------------------------------ | ------------------------------------------------------------------ |
| Security fix in Electron or Chromium | Patch release within 72 hours; target 24 hours for critical issues |
| New Electron major version           | Upgrade within two to four weeks                                   |

- Astela follows the latest stable Electron major. Electron publishes a new major every 8 weeks, supports the latest three majors and ships patch releases two to three times a week per supported line (as of October 2026).
- The weekly `freshness.yml` workflow will turn red when an Electron security release or a known vulnerability in a dependency is pending. It raises an alarm without opening automated pull requests; maintainers then update.
- A weekly CI job will build against the next Electron beta to surface breaking changes early.
- pnpm's `minimumReleaseAge` setting (default 1 day, as of October 2026) would delay urgent Electron patches; the security update procedure in the [maintainer workflow](../maintainers/WORKFLOW.md) will document an override.
- Fully automatic Windows signing within the 24-hour target requires Azure Artifact Signing or an OV certificate (see [updates](updates.md)).

## Documented limits

- The root certificate store, CRLSet and Certificate Transparency data are updated only through Electron updates. This is why the response times above matter.
- There is no ASAR integrity validation on Linux (as of October 2026); package signatures protect the installation there.
- WebAuthn has no PIN entry UI and no hybrid (QR code) passkeys. Device-bound authenticators, such as USB security keys, Windows Hello and Touch ID, remain usable.
- Safe Browsing is unavailable; list-based protection follows in M2.
- AppImage sandbox restrictions on Ubuntu 24.04 and later, and the limits of rollback, are described in [updates](updates.md).

## Privacy

### No telemetry

- Astela collects no telemetry and uploads no crash reports.
- `crashReporter` is used locally only. Crash dumps will be visible on `app://diagnostics`, and users can share them manually.
- An automated test will capture network traffic during 60 seconds of idle time after start and expect no connections other than the allowlisted ones (the update feed check after 30–60 seconds).

### Outbound connections

Every outbound connection will be documented on a "Network connections" documentation page and on `app://diagnostics`, and each one can be redirected or disabled by policy:

| Connection                                                 | Notes                                                                                                                                                                                                                  |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Update feed (GitHub Pages) and downloads (GitHub Releases) | Controlled with `UpdatePolicy` and `UpdateURL` (see [updates](updates.md)).                                                                                                                                            |
| Filter list feed                                           | From M2, for the content blocker.                                                                                                                                                                                      |
| Spellchecker dictionaries                                  | In M1, the spellchecker is off on Windows and Linux; macOS uses the system spellchecker. From M2, dictionaries are self-hosted on GitHub Pages through `setSpellCheckerDictionaryDownloadURL` instead of a Google CDN. |
| Search suggestions                                         | Opt-in.                                                                                                                                                                                                                |

GitHub and GitHub Pages see the IP address during update checks. The privacy statement on the website will say exactly that, and that Astela itself collects nothing.

### Geolocation

- Astela ships no `GOOGLE_API_KEY`.
- Windows and macOS will use the operating system's location provider.
- On Linux, the XDG desktop portal will be evaluated; if it is not usable, the permission will be denied with an explanation.

### Data protection

- Cookies will be encrypted at rest through the `enableCookieEncryption` fuse.
- The WebRTC IP handling policy is `default_public_interface_only`.
- Referrers will be trimmed.
- Secrets are kept in the operating system's key store (see [data](data.md)).

### Later privacy features

| Feature                                                   | Milestone |
| --------------------------------------------------------- | --------- |
| Strict HTTPS-only mode                                    | M2        |
| Blocking of third-party cookies through a Chromium switch | M2        |
| Global Privacy Control (GPC) header                       | M2        |
| Removal of tracking parameters                            | M2        |
| Ad and tracker blocking with signed filter lists          | M2        |
| Malware and phishing lists with an interstitial           | M2        |
| Encrypted password vault                                  | M3        |

The [roadmap](../roadmap.md) lists the milestones.

## Implementation status

The security baseline is implemented in `app/src/platform/electron/` and `app/electron-builder.config.mjs` and checked by end-to-end and package smoke tests:

- Every view runs sandboxed with context isolation and without Node integration; tabs have no preload.
- Every session denies permission requests, permission checks, device access and screen capture by default.
- `<webview>` is never attached; pages cannot open free windows, and their requests become tabs. A tab that a page opens, by script or from its context menu, can only load an http or https URL.
- The shell and internal pages cannot leave their `app://` origin; web content can neither navigate to `app://` nor load it, because web sessions answer such requests with 403.
- All `app://` pages carry the strict Content Security Policy with Trusted Types.
- Client certificates are never selected automatically.
- The user agent carries neither the app nor the Electron token.
- Spellchecking is off on Windows and Linux.
- Every package sets the fuses listed above; the package smoke test reads them back from the installed binary.

Not implemented yet: the permission prompt and site list, the certificate error page, HTTPS-First, DNS over HTTPS, the malware and phishing lists, and the web platform API inventory in CI.
