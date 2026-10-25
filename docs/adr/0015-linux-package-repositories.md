# 0015. Linux package repositories

## Status

Accepted

## Date

2026-10-25

## Validation

Validated on 2026-10-25: installation and upgrades from `0.1.0-beta.1` to `0.1.0` work on Ubuntu 22.04 and 24.04, Debian 12 and 13, and Fedora 43 and 44. See the [validation results](../architecture/validation.md#linux-package-repositories).

## Context

Lampo ships deb packages for amd64 and arm64 and rpm packages for x86_64 and aarch64, next to the AppImage ([ADR 0003](0003-packaging-with-electron-builder.md)). People who install these formats expect updates to arrive with their regular system updates, signed and verified by the package manager.

electron-updater provides updaters for deb and rpm, but they ask for the administrator password and do not verify a GPG signature. That does not fit the quiet, signed update chain of [ADR 0014](0014-update-architecture-with-signed-feed.md).

Prerelease versions need care: a version such as `0.1.0-beta.1` sorts after `0.1.0` in dpkg and rpm, so a beta would never be replaced by the final release.

The website runs on GitHub Pages, which allows 1 GB per site and has a soft traffic limit of 100 GB per month. GitHub Releases has no bandwidth limit. APT resolves package paths relative to the repository root, while DNF metadata can point to packages on another host through `xml:base`.

## Decision

Lampo runs its own APT and DNF repositories, published as part of the website deployment.

- **APT repository** under `/apt` on Pages, with the suites `stable` and `beta`, the architectures `amd64` and `arm64`, and a GPG-signed `InRelease` file. The pool holds the packages themselves, because APT cannot fetch them from another host. Each suite keeps only the last two versions, which keeps the site small and still allows `apt install lampo=<previous version>` as a rollback.
- **DNF repository:** metadata under `/rpm` on Pages, created with `createrepo_c --baseurl` so that `xml:base` points at the GitHub Releases downloads; dnf5 supports this. `repomd.xml` has a detached signature (`repomd.xml.asc`), and every package is signed with `rpmsign`. Betas use a separate repository. Rollback uses `dnf downgrade`.
- **Beta versions** are encoded as `0.1.0~beta.N` in both formats, which sorts before `0.1.0`. Separate suites and repositories keep betas away from stable users.
- **Repository setup on install:** the deb `postinst` script writes the APT source once as a deb822 file with `Signed-By` pointing to the shipped repository key; an environment variable opts out. The rpm `%post` script writes `/etc/yum.repos.d/lampo.repo`, pointing at the repository of the package's channel. Package and file names come from `slug` in `brand.json`.
- **In-app updater:** off for deb and rpm installations, detected through electron-builder's `package-type` marker. electron-updater's deb and rpm updaters are not used.
- **Signing:** one GPG key signs the APT and DNF metadata and the rpm packages. `tools/owner/setup.sh` generates it; the private key is stored only as a secret in the `release` environment and in an encrypted offline backup, and the public key will be committed as `app/build/keys/linux-repo.pub.asc`. Its fingerprint is published in `SECURITY.md` with the first release.
- **Publishing:** `pages.yml` rebuilds and signs both repositories from release data on every deployment; nothing is committed ([ADR 0016](0016-release-pipeline-without-bot-commits.md)). After each release, `verify-live` installs and upgrades from the live repositories with `apt` and `dnf`.
- **Distributions:** Ubuntu and Debian for deb, Fedora and RHEL for rpm; openSUSE is best effort. Containers test installation, upgrade and version order on Ubuntu 22.04, 24.04 and 26.04, Debian 12 and 13, and the current and previous Fedora release ([ADR 0022](0022-test-strategy.md)).
- **Growth:** if traffic approaches the Pages limits, the APT repository moves to dedicated hosting. The source file belongs to the package setup, so a later package version can rewrite it to the new location. DNF is not affected because its packages already come from GitHub Releases.

## Consequences

Positive:

- Updates arrive through `apt upgrade` and `dnf upgrade` like every other system package, with signatures checked by the package manager.
- Administrators keep their usual tooling for mirroring, pinning and staged rollout.
- The browser never asks for a password to update itself.
- The upgrade order from `0.1.0~beta.N` to `0.1.0` is correct for beta users.
- No external hosting service or account is needed.

Negative:

- The APT pool counts against the size and traffic limits of Pages. Only two versions are kept there; older packages remain available from GitHub Releases only.
- Metadata generation, signing and retention are project code that must be tested for every release.
- Writing package sources from `postinst` and `%post` changes the system configuration; it is documented in the admin guide and can be skipped.
- The GPG key expires after five years and must be extended in time; losing it would stop updates for these formats until a new key is distributed. An encrypted offline backup exists.
- Moving the APT repository later requires a package release that rewrites the source file before the old location goes away.

## Alternatives considered

- **electron-updater's deb and rpm updaters:** they prompt for a password and skip GPG verification.
- **AppImage only:** no integration with system updates, and the Chromium sandbox needs extra setup on Ubuntu 24.04 and later.
- **APT packages served from GitHub Releases:** not possible, because APT expects packages relative to the repository root and Pages cannot redirect.
- **Hosted repository services such as packagecloud or Cloudsmith:** add an external account, quotas and terms to the release path.
- **Launchpad PPA:** Ubuntu only, and it expects source packages built on Launchpad instead of the binaries from Lampo's own pipeline.
- **Snap or Flatpak:** separate stores and confinement models that interact with the Chromium sandbox; they can be evaluated later as additional formats, not as a replacement for deb and rpm.
