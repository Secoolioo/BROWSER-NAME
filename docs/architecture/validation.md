# Validation results

Before the first release, the riskiest assumptions of the architecture were tested in seven short experiments on GitHub-hosted runners. This page records what was measured and what changed as a result. All runs used Electron 45.0.0 and electron-builder 26.18.0 on 2026-10-25. The experiment code was throwaway code and is not part of the repository.

## Storage with node:sqlite

[ADR 0009](../adr/0009-storage-with-node-sqlite.md) depends on `node:sqlite` working in a `utilityProcess` everywhere. A worker created 100,000 history rows with an FTS5 index, ran ranked and prefix queries 20 times each, took a snapshot with `VACUUM INTO` and set `PRAGMA user_version`.

| Platform      | SQLite | WAL | Insert 100,000 rows | Ranked query p50 | Prefix query p50 | `VACUUM INTO` |
| ------------- | ------ | --- | ------------------- | ---------------- | ---------------- | ------------- |
| Linux x64     | 3.53.4 | yes | 474 ms              | 28.7 ms          | 38.6 ms          | yes           |
| Linux arm64   | 3.53.4 | yes | 459 ms              | 22.8 ms          | 30.8 ms          | yes           |
| Windows x64   | 3.53.4 | yes | 663 ms              | 16.6 ms          | 22.7 ms          | yes           |
| Windows arm64 | 3.53.4 | yes | 1,163 ms            | 26.3 ms          | 35.3 ms          | yes           |
| macOS arm64   | 3.53.4 | yes | 313 ms              | 17.8 ms          | 24.4 ms          | yes           |
| macOS x64     | 3.53.4 | yes | 865 ms              | 37.3 ms          | 50.8 ms          | yes           |

**Result:** `node:sqlite` is used as planned; the native fallback is not needed. The prefix query on macOS x64 is just above the 50 ms target for history search, so the history module will use an FTS5 prefix index and rank a limited candidate set instead of the naive query used here.

## Moving tabs between windows

A `WebContentsView` with typed form input, a scroll position and a running timer was moved from one `BaseWindow` to another.

| Platform                             | Move time | No reload | Same renderer process | State kept | Focus after move |
| ------------------------------------ | --------- | --------- | --------------------- | ---------- | ---------------- |
| Linux x64 (X11)                      | 0.35 ms   | yes       | yes                   | yes        | yes              |
| Linux x64 (Wayland, headless Weston) | 0.34 ms   | yes       | yes                   | yes        | yes              |
| Linux arm64                          | 0.62 ms   | yes       | yes                   | yes        | yes              |
| Windows x64                          | 2.51 ms   | yes       | yes                   | yes        | yes              |
| Windows arm64                        | 2.72 ms   | yes       | yes                   | yes        | yes              |
| macOS arm64                          | 1.39 ms   | yes       | yes                   | yes        | yes              |
| macOS x64                            | 1.64 ms   | yes       | yes                   | yes        | yes              |

**Result:** drag and drop between windows moves the view itself, as designed in the [overview](overview.md#windows-tabs-and-workspaces).

## Signed update feed and delta updates

Two builds, `0.0.1` and `0.0.2`, were served from a local signed feed. The installed `0.0.1` had to reject a feed with a bad signature, an expired feed and a feed with a lower sequence number, and then update itself silently.

| Format                         | Package size  | Downloaded for the update | Rejected bad feeds | Silent update |
| ------------------------------ | ------------- | ------------------------- | ------------------ | ------------- |
| Windows NSIS (x64)             | 113,000,943 B | 779,399 B                 | all three          | yes, 17 s     |
| Linux AppImage (x64)           | 123,935,264 B | 376,275 B                 | all three          | yes, 3 s      |
| macOS zip (arm64), self-signed | 115,300,831 B | 115,300,831 B             | all three          | yes, 7 s      |

**Results:**

- The custom provider of [ADR 0014](../adr/0014-update-architecture-with-signed-feed.md) works with electron-updater 6.8.11. The provider must pass the `blockMapSize` of an AppImage from `latest-linux.yml` into the signed manifest; without it, the AppImage update falls back to a full download.
- NSIS with a separate block map already yields small deltas, so `nsis-web` is not needed.
- On macOS, Squirrel.Mac accepts updates signed with a self-signed certificate that is trusted for code signing, so the planned path without an Apple Developer ID works. The first update after an installation from a zip downloads the full package, because no earlier zip is cached; later updates can use the block map.

## Linux sandbox with restricted user namespaces

On Ubuntu 24.04 (x64 and arm64) with `kernel.apparmor_restrict_unprivileged_userns=1`:

| Variant                                                                                      | Renderer sandboxed | Notes                                                |
| -------------------------------------------------------------------------------------------- | ------------------ | ---------------------------------------------------- |
| deb with the AppArmor profile that electron-builder installs                                 | yes                | namespace sandbox                                    |
| deb without profile and without SUID helper                                                  | no start           | Chromium refuses to start, which is the safe outcome |
| deb with only the SUID helper                                                                | yes                | SUID sandbox                                         |
| AppImage, binary started directly, no profile                                                | no start           | detectable exit, see below                           |
| AppImage, binary started directly, with an AppArmor profile for `/tmp/.mount_*/<executable>` | yes                | namespace sandbox                                    |
| AppImage through the launcher that electron-builder generates                                | no                 | the launcher adds `--no-sandbox` silently            |

**Results:**

- The AppArmor profile for the AppImage mount path works as planned in the [updates architecture](updates.md).
- The launcher that electron-builder generates for AppImages adds `--no-sandbox` whenever `unshare` fails, and the generated desktop entry adds it as well. That contradicts the rule that the sandbox is never switched off silently. Lampo's AppImage therefore ships its own launcher: it starts the browser with the sandbox, and only if Chromium refuses to start for lack of a sandbox does it open the local fix page in a restricted mode without web content.
- fpm, which electron-builder uses for deb and rpm, expands the words `NAME`, `VERSION` and `ARCH` in output paths. Packages are therefore built into a temporary directory outside the checkout.

## Linux package repositories

deb and rpm packages of `0.1.0-beta.1`, `0.1.0-beta.2` and `0.1.0` were published in signed repositories: APT with `InRelease`, DNF with signed `repomd.xml`, signed rpm packages and `xml:base` pointing to versioned release directories. The signing key was an Ed25519 GPG key.

| Distribution | Package manager | Install beta.1 | Upgrade to beta.2 | Upgrade to 0.1.0 |
| ------------ | --------------- | -------------- | ----------------- | ---------------- |
| Ubuntu 22.04 | APT             | yes            | yes               | yes              |
| Ubuntu 24.04 | APT             | yes            | yes               | yes              |
| Debian 12    | APT             | yes            | yes               | yes              |
| Debian 13    | APT             | yes            | yes               | yes              |
| Fedora 43    | dnf5 5.2.18     | yes            | yes               | yes              |
| Fedora 44    | dnf5 5.4.3      | yes            | yes               | yes              |

**Result:** [ADR 0015](../adr/0015-linux-package-repositories.md) works as decided. electron-builder 26.18 already writes prerelease versions as `0.1.0~beta.N` for deb and rpm, so they sort before `0.1.0`.

## Web platform API inventory

A sandboxed page in a packaged build listed every global and `navigator` property (about 1,250 globals) and called every global `availability()` function.

**Results:**

- Chromium 156 exposes several on-device language APIs (`LanguageModel`, `Summarizer`, `LanguageDetector`, `Translator`). In Electron they report `unavailable`, and `Translator.availability()` never resolves, because the services behind them are missing. None of them works in Lampo, so no setting is needed.
- `navigator.userAgentData.brands` reports `Chromium`, as planned for the user agent.
- With spellchecking at its default, Electron downloaded a dictionary from a Google server at startup. This confirms the decision to switch spellchecking off on Windows and Linux in M1 and to host dictionaries in M2 (see [security](security.md)).
