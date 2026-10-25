# 0004. TypeScript toolchain and build

## Status

Accepted

## Date

2026-10-25

## Context

All of Astela's code (main process, preloads, browser UI, tools and website) is written in TypeScript. The same source runs through several tools: the type checker, the bundler for the app, Node itself for tooling scripts, test runners and documentation generators. Each of these tools strips or compiles TypeScript in its own way.

As of October 2026, TypeScript 7.0 ships a native compiler that type-checks much faster than the JavaScript-based compiler, but it has no stable programmatic API yet; that is expected with TypeScript 7.1. Tools that consume the compiler API, such as TypeDoc and the Astro type checker, still need TypeScript 6.0. Node 24, the LTS line that matches Electron 45's Node 24.22, can run TypeScript files directly through type stripping, but only for syntax that can be erased without transformation. Vite 8 compiles TypeScript with Oxc and bundles with Rolldown.

## Decision

- **Language:** TypeScript in strict mode everywhere.
- **Erasable syntax only:** `erasableSyntaxOnly`, `verbatimModuleSyntax`, `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess` are enabled in every project. Enums, namespaces, parameter properties and decorators are therefore not used. The same code behaves identically under TypeScript 7, Oxc and Node type stripping.
- **Type checking:** `tsc` from TypeScript 7.0 runs all type checks and build checks, including the per-layer project references described in [ADR 0021](0021-repository-layout-and-architecture-rules.md).
- **Compiler API consumers:** TypeScript 6.0.3 is installed under an alias and used only by tools that need the compiler API (TypeDoc and the Astro check, see [ADR 0020](0020-documentation-site-and-api-docs.md)). The website package keeps these dependencies separate from the app. The alias is reviewed when TypeScript 7.1 provides a stable API.
- **Build:** Vite 8 with Rolldown, driven by electron-vite 6, builds the main process, the preloads and the renderer UI. Runtime dependencies of the main process are bundled as well, which keeps the packaged app small and its start-up path short.
- **Code splitting:** each feature module produces its own chunks for main and UI code, loaded with `import()` only when the module is active ([ADR 0010](0010-module-system-and-lazy-loading.md)).
- **Tooling scripts:** scripts in `tools/` run directly with Node 24 type stripping, without a separate compile step.
- **Runtime:** Node 24 LTS is the development runtime, matching the Node version inside Electron 45.

```ts
// Allowed: erasable syntax only.
export const TabState = {
  Unloaded: 'unloaded',
  Live: 'live',
  Sleeping: 'sleeping',
} as const;
export type TabState = (typeof TabState)[keyof typeof TabState];
```

## Consequences

Positive:

- Type checking with the native compiler is expected to stay fast enough to run on every save and in every pull request.
- One syntax subset works in every tool, so no tool-specific transformation can change behavior between tests, scripts and the shipped app.
- Fast incremental builds and per-module chunks support the start-up and bundle budgets in [ADR 0017](0017-performance-budgets-in-ci.md).

Negative:

- Two TypeScript versions are installed side by side until 7.1, and both must agree on the code; type errors that only one of them reports are possible during the transition.
- Familiar constructs such as `enum` and parameter properties are unavailable; constant objects and explicit field assignments replace them.
- Decorator-based libraries cannot be used, which shapes the UI and dependency injection choices ([ADR 0005](0005-ui-with-lit-web-components.md), [ADR 0006](0006-dependency-injection-container.md)).
- Vite 8, Rolldown and electron-vite 6 are recent major versions; upgrades need the full test matrix.

## Alternatives considered

- **TypeScript 6.0 only:** a single version, but noticeably slower type checking for a codebase of this size.
- **TypeScript 7.0 only:** TypeDoc and the Astro check cannot run without a stable compiler API.
- **Full TypeScript syntax with a transpiler such as Babel or SWC:** more tools in the chain, and Node type stripping could no longer run the same code.
- **webpack or plain esbuild:** slower builds or more custom configuration for the three Electron targets; electron-vite covers main, preload and renderer in one setup.
- **Running TypeScript through a loader such as tsx in production:** adds start-up cost and a dependency that bundling makes unnecessary.
