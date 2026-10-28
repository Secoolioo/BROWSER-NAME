# 0022. Test strategy

## Status

Accepted

## Date

2026-10-25

## Context

Astela has many areas where a regression is expensive: package formats on three operating systems and two architectures, updates and rollback, data migrations, policies from the registry, managed preferences and JSON files, security hardening, accessibility and performance. A team of three cannot test this by hand for every update, so automation has to catch regressions and manual checks are limited to what machines cannot judge.

Playwright drives Electron apps through `_electron`, which needs the `nodeCliInspect` fuse; shipped builds disable that fuse ([security](../architecture/security.md)).

## Decision

The levels below run automatically in CI; those that run on pull requests are required through `ci-gate`. Details are described in [testing](../architecture/testing.md).

| Level         | Tool                                                                                          | Scope                                                                                                                                                                                                                                                     | Runs                                                             |
| ------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Unit          | Vitest 5                                                                                      | `shared`, `kernel`, `domain` and module logic with in-memory adapters                                                                                                                                                                                     | every pull request, three OS                                     |
| Integration   | Vitest in Node                                                                                | platform adapters against the real file system and SQLite, migrations against golden profiles, policy providers against real sources, IPC router with property-based fuzzing (fast-check)                                                                 | every pull request, three OS                                     |
| Component     | Vitest Browser Mode (Chromium)                                                                | Web Components of the shell and internal pages, axe-core                                                                                                                                                                                                  | every pull request                                               |
| End-to-end    | Playwright 1.64 `_electron`                                                                   | a packaged `--dir` build with a local fixture server: tab bar positions, drag and drop, workspaces, themes, settings, shortcuts, session restore, private windows, downloads, history, bookmarks, switching between English and German, keyboard use, axe | every pull request, three OS                                     |
| Package smoke | scripts and the built-in `--smoke-test` mode                                                  | silent install of every package, start, JSON report (versions, modules, timings, sandbox status, fuses), exit code 0, clean uninstall                                                                                                                     | every pull request unsigned, releases signed where secrets exist |
| Updater       | local test feed on 127.0.0.1                                                                  | builds `X-test.1` to `X-test.2` with a test key; detection, delta, signature, install on quit, restart, restored session, migrated data; negative cases; rollback; local APT and DNF repositories                                                         | every pull request (AppImage, NSIS), every release (all formats) |
| Performance   | own harness                                                                                   | budgets and regressions against `main` ([ADR 0017](0017-performance-budgets-in-ci.md))                                                                                                                                                                    | every pull request, three OS                                     |
| Security      | CodeQL, osv-scanner, dependency-review, zizmor, OpenSSF Scorecard, secret scanning, own tests | `webPreferences` of every created WebContents, fuse state of the packaged binary, CSP of `app://` pages, navigation locks of the shell                                                                                                                    | every pull request and weekly; Scorecard on `main` and weekly    |
| Documentation | TypeDoc, markdownlint, Mermaid, lychee, Astro                                                 | strict API docs, Markdown lint, diagram rendering, links, site build ([ADR 0020](0020-documentation-site-and-api-docs.md))                                                                                                                                | every pull request                                               |
| i18n          | script                                                                                        | every key in every locale, no orphaned keys, consistent placeholders ([ADR 0023](0023-internationalization.md))                                                                                                                                           | every pull request                                               |

Further rules:

- **Coverage gate:** at least 90% of lines in `domain` and `kernel`, at least 80% overall; CI fails below.
- **Packaged builds:** end-to-end tests use a build that is identical to the shipped one except for the `nodeCliInspect` fuse. The shipped package itself is checked by the `--smoke-test` mode and by reading its fuses.
- **Real mechanisms, no test backdoors:** the updater tests set the mirror through the real policy mechanism. Policy providers are tested against an `HKCU` test key on Windows, a plist in `/Library/Managed Preferences` on macOS and JSON files in a temporary directory on Linux.
- **Linux sandbox:** sandbox tests run directly on the `ubuntu-24.04` runner with `kernel.apparmor_restrict_unprivileged_userns=1`; containers cover installation, dependencies and upgrade order on further distributions ([ADR 0015](0015-linux-package-repositories.md)).
- **Drag and drop across windows:** hit testing and the drag session are unit-tested, and end-to-end tests use `webContents.sendInputEvent` across two windows, because Playwright's mouse is bound to one page.
- **Visual and accessibility checks:** screenshot diffs of all four tab bar positions and layout presets in light and dark; axe without serious or critical findings; accessibility tree snapshots as regression tests.
- **No skipping:** tests are never skipped, disabled or quarantined. Playwright runs with zero retries in CI, and flaky tests are fixed first.
- **Fixtures:** own test pages served locally, deterministic and free of third-party brands. Golden profiles of every released version are created by `pnpm release:prepare` in the release pull request, not by a workflow.
- **Manual checks once per minor release:** screen reader smoke tests, the Intune import of the policy templates and the design review, as listed in [WORKFLOW.md](../maintainers/WORKFLOW.md).
- **Runners:** `ubuntu-24.04`, `windows-2025` and `macos-15`, with additional arm64 runners for packages.

## Consequences

Positive:

- Packages are tested the way users install them, on every pull request.
- Updates, rollback and migrations are expected to be proven before every release instead of discovered in the field.
- Zero retries keep flaky behavior visible instead of hiding real bugs.
- Property-based IPC tests exercise invalid input that hand-written cases would miss.

Negative:

- The pipeline needs many runner minutes, especially on macOS, and pull requests wait longer for `ci-gate`.
- The end-to-end build differs from the shipped build by one fuse; the smoke test closes that gap only partially.
- A flaky test blocks merges until it is fixed.
- Fixtures and golden profiles grow with every release and need care.
- Runners render without a GPU, so GPU-specific problems are not covered.

## Alternatives considered

- **Jest:** slower and needs extra configuration for ESM and TypeScript; Vitest shares the Vite configuration of the build.
- **Spectron:** deprecated and no longer maintained.
- **End-to-end tests against an unpacked development build:** would miss packaging, asar, fuses and protocol registration.
- **Retries and a quarantine list:** hide real bugs and let flaky tests accumulate.
- **Manual QA before every release:** does not scale for a team of three and is not reproducible.
