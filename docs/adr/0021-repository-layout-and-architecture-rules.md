# 0021. Repository layout, linting and architecture rules

## Status

Accepted

## Date

2026-10-25

## Context

The repository is designed to hold three different things: the browser itself with a strictly layered architecture ([overview](../architecture/overview.md)), the website with Astro, Starlight and TypeScript 6 ([ADR 0020](0020-documentation-site-and-api-docs.md)), and tooling for generators, code generation, releases, feeds and package repositories. Layer boundaries that are only conventions erode under time pressure, and a team of three cannot review every import by hand. Checks have to be fast enough to run on every save and every push, and dependencies with install scripts are a supply chain risk.

## Decision

Astela is a pnpm 12 workspace with three packages, `app`, `website` and `tools`, on Node 24 LTS, with architecture rules enforced by the compiler, dependency-cruiser and the linter.

- **Workspace:** the root holds the shared configuration and the `pnpm verify` script; the generators (`pnpm new:*`) and `pnpm release:prepare` will be added there. There is no Turborepo or Nx. The `website` package keeps TypeScript 6 and Astro dependencies away from the app.
- **Runtime:** Node 24 LTS, the same major version as the Node 24.22 inside Electron 45, pinned in `.node-version`; pnpm is pinned through `packageManager`.
- **Dependencies:** exact versions only. `allowBuilds` in `pnpm-workspace.yaml` is the allowlist of packages that may run install scripts; all others are blocked.
- **Layout of the browser package:**

  ```text
  app/
    src/
      shared/     pure TypeScript: IPC contracts, ids, result, events, utilities
      kernel/     DI container, module system, events, lifecycle, logging API
      domain/     entities, services and ports without Electron, Node or DOM
      platform/   adapters: electron/, node/, os/{windows,macos,linux}/
      modules/    one folder per feature module: manifest.ts, main/, ui/, api/, locales/
      main/       composition root, bootstrap, boot guard
      preload/    capability-scoped bridges per view type
      ui/         ui-kit/ (base element, tokens, controls), shell/, overlay/, pages/
    tests/        e2e/, perf/, smoke/, updater/, screenshots/, fixtures/
    build/        electron-builder configuration, icons, entitlements, installer and Linux files, public keys
  ```

- **TypeScript project references** per layer, each with `composite`: `shared`, `kernel`, `domain`, `platform`, `modules-main`, `modules-ui`, `preload`, `ui` and `main`. An import from a project that is not referenced fails the type check. `lib` and `types` are restricted per project: `shared`, `kernel` and `domain` see neither DOM nor Node types; `ui`, `modules-ui` and `preload` see no Node types.
- **dependency-cruiser** enforces the layer direction and forbids cycles: `main` may use modules, `platform`, `domain` and `kernel`; modules use `domain`, `kernel` and `shared`; `platform` uses `domain` and `kernel`; `domain` uses `kernel`; `kernel` uses `shared`; `ui`, `modules/*/ui` and `preload` use only `shared`. In addition, `electron` may be imported only in `platform/`, `main/` and `preload/`; `modules/a` may import `modules/b` only through `modules/b/api`; `ui/` never imports browser-process code; module manifests may import only data files (`*.contrib.ts`); and each layer has a list of forbidden packages.
- **Linting:** Oxlint with type-aware rules, including `no-floating-promises`, plus `no-restricted-imports` rules that mirror the layer rules for fast feedback in the editor. Prettier formats all files, markdownlint checks Markdown, and ShellCheck checks shell scripts.
- **Commits:** lefthook runs commitlint on every commit message locally; in CI, the `pr-title` check runs commitlint on the pull request title, which becomes the squash commit message, and the `commits` job rejects trailers and more than one author ([WORKFLOW.md](../maintainers/WORKFLOW.md)).
- **Generators:** `pnpm new:module`, `new:setting`, `new:theme`, `new:policy`, `new:adr` and `new:locale` create files with test and documentation stubs that already satisfy these rules.
- **One command:** `pnpm verify` runs the same checks as the CI `verify` job.

## Consequences

Positive:

- Boundary violations are expected to fail at type-check time or in CI instead of being found in review.
- Electron stays behind the `platform` facade, so Electron upgrades remain local changes.
- Linting and formatting are fast enough to run on every save and in the pre-commit hook.
- The app's toolchain stays free of website dependencies.
- The install-script allowlist reduces the impact of a compromised dependency.

Negative:

- Nine TypeScript projects and the dependency-cruiser configuration need maintenance when layers change; such changes need an ADR ([ADR 0001](0001-record-architecture-decisions.md)).
- Project references, dependency-cruiser and lint rules overlap on purpose; a rule change has to be made in all of them.
- Oxlint has fewer plugins than the ESLint ecosystem, so some niche rules are unavailable.
- pnpm's `minimumReleaseAge` delays new versions by one day by default, which also delays urgent Electron patches; the security update process in [WORKFLOW.md](../maintainers/WORKFLOW.md) will document the override.

## Alternatives considered

- **npm or Yarn workspaces:** no per-package allowlist for install scripts and weaker protection against undeclared dependencies.
- **Turborepo or Nx:** task orchestration and caching that three packages do not need, at the price of extra configuration.
- **ESLint with typescript-eslint:** a mature option, but type-aware linting is much slower.
- **Biome:** fast, but its type-aware rules are still in the nursery group.
- **A single package:** TypeScript 6 and Astro dependencies would mix with the app's TypeScript 7 toolchain.
- **Layer rules by convention only:** erode as the code grows and cannot be checked by a small team.
