# 0014. Update architecture with a signed feed

## Status

Accepted

## Date

2026-10-25

## Context

Lampo updates itself on Windows, macOS and Linux across several package formats: NSIS, MSI, dmg and zip, AppImage, deb and rpm ([ADR 0003](0003-packaging-with-electron-builder.md)). Updates have to be quiet and safe: no dialogs, no data loss, and a way back when a new version fails to start. Organizations need to switch updates off, choose a channel, pin a version prefix and point clients at an internal mirror.

electron-updater 6.8 handles download, blockmap deltas, SHA-512 checks and installation for NSIS, macOS and AppImage. Its standard providers trust an unsigned `latest.yml`, so whoever controls the download location controls what gets installed. It has no notion of feed expiry, rollback protection or policy-driven channels.

Binaries are large and are hosted on GitHub Releases, which has no bandwidth limit. GitHub Pages suits small files that are redeployed often.

## Decision

Lampo uses electron-updater 6.8.x in the browser process as the installation engine, behind its own signed feed.

- **Feed layout:** `updates/v1/index.json` on Pages lists the releases per channel with a monotonic `sequence`, `issuedAt` and `expiresAt` (30 days after issue). Each version has a manifest `releases/<version>.json` that lists the artifacts per OS, architecture and format with file name, size, SHA-512 and blockmap, relative to `downloadBase`. The default base is the GitHub Releases download location of the version's tag; the `UpdateURL` policy replaces it with a mirror.
- **Signatures:** index and manifests carry detached Ed25519 signatures (`.sig`), verified with Node's `crypto.verify` without extra dependencies. The binary embeds two public keys, the current one and its successor, so the signing key can rotate without breaking installed clients. The successor's private key stays offline until the rotation.
- **Rejection:** an invalid signature, a `sequence` lower than the last one seen (rollback attack), an expired `expiresAt` (freeze attack), and any downgrade that no policy allows.
- **Trust chain:** Ed25519 from index to manifest, SHA-512 for each file, then the platform code signature where available (Authenticode on Windows, code signing on macOS).
- **Provider:** a `SignedFeedProvider` implements electron-updater's `custom` provider (`getLatestVersion()` and `resolveFiles()`) and returns data from verified manifests only. Format-specific `IUpdateInstaller` strategies wrap `NsisUpdater`, `MacUpdater` and `AppImageUpdater`.
- **Formats outside the in-app updater:** MSI installations are detected through a marker under `HKLM` and are updated by IT tooling. deb and rpm installations update through the system package manager from Lampo's own repositories ([ADR 0015](0015-linux-package-repositories.md)). The in-app updater is off for all three.
- **Freshness:** `pages.yml` re-signs the feed weekly with a new `expiresAt`; that is a deployment, not a commit ([ADR 0016](0016-release-pipeline-without-bot-commits.md)). With an expired feed nothing is installed, "About" and `app://diagnostics` report the stale feed, and `freshness.yml` turns red. GitHub pauses schedules in public repositories after 60 days without activity, so a manual re-sign through `workflow_dispatch` will be documented in [WORKFLOW.md](../maintainers/WORKFLOW.md) together with the release pipeline. Mirrors must synchronize at least every 14 days. There is deliberately no second feed as a release asset: it would expire and conflict with the Pages feed.
- **Flow without dialogs:** the first check runs 30–60 s after start, outside the start-up path, then every 4 h with ±30 min jitter and only when online. Downloads run in the background with deltas. A staged update shows a small dot on the menu button, a "Restart to update" entry and a status in "About". It installs silently on a normal quit, or during idle time with a silent restart and session restore when the update has been ready for at least 2 h, the system has been idle for at least 30 min, and no audio, video, download, WebRTC session or private window is active. A system shutdown never starts an installation; it then runs at the next start before the window opens. Afterwards a non-modal "What's new in vX.Y" note links to the changelog.
- **Channels:** `stable` and `beta`; beta also receives stable versions. Moving from beta to stable never downgrades: the client stays on its version until stable overtakes it.
- **Policies:** `UpdatePolicy` (0 off, 1 automatic, 2 manual only), `TargetChannel`, `TargetVersionPrefix` (the highest matching version in the index), `UpdateURL` and `AutoUpdateCheckPeriodMinutes`. `RollbackToTargetVersion` and a maintenance window follow in M5 ([enterprise](../architecture/enterprise.md)).
- **Mirror:** `tools/mirror` copies feed and packages one to one to an internal HTTP server; signatures stay valid because artifact URLs are relative.
- **Rollback with the BootGuard:** before an update is applied, the running version writes `boot-state.json` with `pending`, `previous` and `attempts` and keeps a verified installer of itself locally. The first lines of the new version's main code increment `attempts`; the version counts as healthy once the shell has painted, the profile database is open and it has run for 10 s without crashing. After two failed starts, the previous version is restored from the local package without network access, the data snapshots taken before migrations are restored ([ADR 0009](0009-storage-with-node-sqlite.md)), and the failed version is blocked locally until a newer one appears.

The full flow per format is described in [updates](../architecture/updates.md).

## Consequences

Positive:

- A compromised download host or mirror cannot push code, which closes the unsigned `latest.yml` gap of electron-updater.
- Rollback and freeze attacks are detected, and key rotation needs no special release.
- Organizations get channel, version pin, mirror and off switch through the same policies on every OS ([ADR 0012](0012-policy-providers-per-os.md)).
- Delta downloads and silent installation are expected to keep updates small and unnoticed.
- A release that fails to start is expected to roll back on its own instead of leaving users with a broken browser.

Negative:

- The feed, its verification and the BootGuard are security-critical project code; they need updater tests on every pull request ([ADR 0022](0022-test-strategy.md)).
- If weekly re-signing stops, the feed expires and clients stop updating until a maintainer re-signs. This fails safe but needs attention.
- Losing the signing keys would end updates for installed clients; the successor key and an encrypted offline backup reduce that risk.
- The custom provider couples Lampo to electron-updater's provider interface, which must be rechecked on every upgrade.
- The BootGuard cannot detect crashes before the first JavaScript runs, such as a damaged binary; package smoke tests in the release pipeline cover that case.
- MSI installations get no in-app updates until M5 adds an optional update service for them.

## Alternatives considered

- **electron-updater with its GitHub provider:** trusts an unsigned `latest.yml` and has no expiry, no rollback protection and no policy-driven channels.
- **Full TUF (The Update Framework):** strong guarantees, but its roles and metadata are heavier than a project with a single release signer needs. The feed keeps TUF's key ideas: signed metadata, a monotonic sequence and expiry.
- **update.electronjs.org or Squirrel alone:** no Linux formats, no mirrors and no enterprise policies, and an external service would sit in the update path.
- **Native updaters per OS such as Sparkle or WinSparkle:** three update systems to maintain and no shared feed or policy model.
- **A custom downloader and installer:** would duplicate the blockmap deltas and per-format installation that electron-updater already provides.
- **Binaries on Pages:** would exceed the size and traffic limits of Pages.
