# Changelog

All notable changes are listed here, newest first. Versions follow [Semantic Versioning](https://semver.org); prereleases (`-beta.N`) are published on the beta channel.

## [0.1.0-beta.1] - 2026-10-29

The first beta: a minimal browser that already runs through the complete package, update, release and website chain. It is meant for testing, not for daily use yet.

### Features

- Browser windows with tabs and an address bar that tells addresses from searches. Tabs open, close, switch and reopen after closing; pages go back, forward and reload, from the toolbar or with keyboard shortcuts.
- Security baseline: every page runs sandboxed and isolated, permission requests are denied, and web pages cannot open the browser's internal pages. The browser sends no telemetry.
- Policies from the Windows registry, macOS configuration profiles and JSON files on Linux, read before the first window opens.
- Signed updates on the beta channel with delta downloads. If a new version fails to start twice, the previous version comes back on its own.

### Packaging

- Windows installer (NSIS), macOS disk image and Linux AppImage, deb and rpm packages, each for x64 and arm64. MSI packages start with 0.1.0, the first stable release. The Windows installer closes a running browser without PowerShell or WMI, whose queries took minutes on some systems.
- APT and DNF repositories for the deb and rpm packages. Installing a package adds its repository, so the browser updates with the system.
- Every release ships `SHA256SUMS` with two signatures, a software bill of materials and build provenance attestations, so every download can be verified.

### Documentation

- Website with a download page, the roadmap, the architecture documentation and decision records, the maintainer workflow, an API reference and this changelog.
