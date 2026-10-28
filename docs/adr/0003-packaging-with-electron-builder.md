# 0003. Packaging with electron-builder

## Status

Accepted

## Date

2026-10-25

## Validation

Validated on 2026-10-25, with two adjustments: the AppImage gets its own launcher because the generated one disables the sandbox silently, and packages are built outside the checkout because fpm expands `NAME`, `VERSION` and `ARCH` in paths. See the [validation results](../architecture/validation.md#linux-sandbox-with-restricted-user-namespaces).

## Context

Astela ships on Windows, macOS and Linux, on x64 and arm64, and must be installable by home users as well as by IT departments. That requires a wide set of formats: a per-user installer and a per-machine MSI on Windows, dmg and zip on macOS, and AppImage, deb and rpm on Linux. Every package needs the same security hardening, must be signable as soon as certificates are available, and has to work with the update chain in [ADR 0014](0014-update-architecture-with-signed-feed.md) and the package repositories in [ADR 0015](0015-linux-package-repositories.md).

## Decision

Astela packages all formats with electron-builder 26.18.x. Version 27 is evaluated once it is stable.

| Platform | Formats                               | Architectures                   | Notes                                                                                                     |
| -------- | ------------------------------------- | ------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Windows  | NSIS (per-user, no admin rights)      | x64, arm64                      | Default for home users                                                                                    |
| Windows  | MSI (per-machine)                     | x64                             | Stable releases only; arm64 uses NSIS until a dedicated WiX template arrives in M5                        |
| macOS    | dmg for installation, zip for updates | x64, arm64 (separate builds)    | Signed with a stable self-signed certificate until a Developer ID is available, then signed and notarized |
| Linux    | AppImage, deb, rpm                    | x86_64 / amd64, arm64 / aarch64 | deb and rpm are served from Astela's own repositories                                                     |

The configuration lives in `app/build/` and follows these rules:

- Fuses are set through `electronFuses`: `runAsNode` off, `enableCookieEncryption` on from the first release, `enableNodeOptionsEnvironmentVariable` off, `enableNodeCliInspectArguments` off, `enableEmbeddedAsarIntegrityValidation` on, `onlyLoadAppFromAsar` on, `grantFileProtocolExtraPrivileges` off. The package smoke test reads them back from every built binary.
- The MSI is a native MSI, not `msiWrapped`: `perMachine: true`, a fixed and explicit `upgradeCode` that never changes, a major upgrade with downgrade protection, and the properties `INSTALLDIR` and `DESKTOP_SHORTCUT=0` added through the `msiProjectCreated` hook.
- `electronLanguages` is limited to the shipped UI languages, English and German, which saves up to 12.8 MB compressed on Windows; the asar archive unpacks as little as possible.
- Asset names carry no version (for example `astela-windows-x64-setup.exe`, `astela-macos-arm64.dmg`, `astela-linux-x86_64.AppImage`), so `releases/latest/download/<asset>` links stay stable. Names derive from `brand.json`.
- deb and rpm encode prereleases as `X.Y.Z~beta.N` so they sort before the final release.
- deb and rpm include an AppArmor profile with `userns` and a SUID sandbox fallback, so the Chromium sandbox works on Ubuntu 24.04 and later.
- Signing runs through electron-builder's signing hooks only when the signing secrets are present; without them, every format is built unsigned.
- Every format and architecture is built on a native runner, except macOS x64, which is built on an arm64 runner and smoke-tested on an Intel runner.

## Consequences

Positive:

- One tool covers every target format, which keeps the release pipeline ([ADR 0016](0016-release-pipeline-without-bot-commits.md)) small.
- Fuses, signing and update metadata (blockmaps) come from the same configuration, so the shipped packages match what CI tests.
- The NSIS, AppImage and macOS outputs work directly with electron-updater.

Negative:

- electron-updater cannot update an MSI installation, so MSI installs are updated by IT ([ADR 0014](0014-update-architecture-with-signed-feed.md)).
- For arm64, electron-builder marks the MSI as x64, which is why arm64 MSI support waits for a dedicated WiX template.
- Astela depends on the pace and quality of a single community-maintained tool; a major upgrade of electron-builder needs the full package smoke and updater test matrix.
- Packages are large because Electron dominates their size; the budgets in [ADR 0017](0017-performance-budgets-in-ci.md) compare against bare Electron packages of the same format.

## Alternatives considered

- **Electron Forge:** the official tool, but it has no built-in AppImage target, and the remaining formats would need several separate makers.
- **electron-packager plus one tool per format:** more moving parts and no shared fuse, signing and blockmap handling.
- **`msiWrapped` MSI:** wraps the NSIS installer instead of producing a real per-machine MSI, which fits enterprise deployment poorly.
- **Hand-written packaging scripts:** full control, but every format, signature and update artifact would have to be built and maintained by the team.
