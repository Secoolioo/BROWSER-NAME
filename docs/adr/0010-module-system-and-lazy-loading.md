# 0010. Module system and lazy loading

## Status

Accepted

## Date

2026-10-25

## Context

Lampo aims to be lean by design: a feature that is turned off should cost nothing, neither start-up time nor memory nor parsed code. At the same time, features contribute to many shared surfaces: settings, policies, commands, keybindings, IPC channels, UI slots and translations. Administrators must be able to turn optional features off by policy, and safe mode must start without them. Settings, policy templates and documentation are generated from the same declarations ([ADR 0011](0011-settings-schema-as-single-source.md)), so the declarations have to be available without loading feature code.

## Decision

Lampo is a microkernel with feature modules. Each feature is a module in `app/src/modules/<id>/`:

- `manifest.ts`: static, purely declarative metadata; tiny and always bundled.
- `main/`: code for the browser process, in its own chunk, loaded with `import()`.
- `ui/`: web components in their own chunk, loaded only when the module is active.
- `api/`: the module's public contract for other modules (tokens, types, IPC contracts).
- `locales/`, `settings.ts`, `policies.ts`, `migrations/` and `__tests__/`.

```ts
export default defineModule({
  id: 'workspaces',
  dependsOn: ['tabs', 'settings', 'themes'],
  activation: { setting: 'workspaces.enabled', policy: 'WorkspacesEnabled', default: true },
  contributes: { settings, policies, commands, keybindings, ipc, uiSlots: ['tabstrip.header'] },
  main: () => import('./main/workspaces.module.js'),
  ui: () => import('./ui/index.js'),
});
```

Start-up follows a fixed sequence:

1. The `ModuleRegistry` reads all manifests.
2. The `ActivationResolver` computes the active set from policies, settings and dependencies.
3. The active modules are sorted topologically.
4. Each module is loaded with `import()` and instantiated in its own child container ([ADR 0006](0006-dependency-injection-container.md)).
5. `activate(ctx)` runs; the context registers commands, IPC handlers, settings listeners and UI slots as disposables.

Deactivating a module calls `deactivate()` and disposes everything it registered. Modules marked `restartRequired` change state at the next start.

Rules that keep the system lean:

- Manifests may import only pure data files (`*.contrib.ts`) with setting, policy, command and keybinding definitions; handlers and schemas with logic live in the module chunks. dependency-cruiser enforces this ([ADR 0021](0021-repository-layout-and-architecture-rules.md)).
- A module may import another module only through that module's `api/`.
- A test asserts that the chunks of disabled modules are never requested.
- Core modules are always active: `windows`, `tabs`, `navigation`, `settings`, `policy`, `themes`, `i18n`, `session`, `updates` and `diagnostics`. Every other module is optional and gets an `<Module>Enabled` policy ([ADR 0012](0012-policy-providers-per-os.md)).
- Security guards (permission handlers, navigation and window guards, the `app://` registration) belong to the kernel, not to any module ([ADR 0008](0008-internal-pages-via-app-protocol.md)).
- The main entry point loads only the boot guard, policies, settings and the first window before the first paint; everything else follows through `import()`.

## Consequences

Positive:

- Disabled features cost no parsing, no memory and no start-up time, which supports the budgets in [ADR 0017](0017-performance-budgets-in-ci.md).
- `--safe-mode` and per-module policies fall out of the same activation logic.
- Generators can read every manifest without loading feature code, so settings pages, policy templates and documentation stay complete.
- Clear module boundaries keep features independent and testable.

Negative:

- The split between `*.contrib.ts` data and logic adds files and a rule that contributors have to learn.
- Cross-module features need an explicit `api/` contract, even for small interactions.
- Lazy loading moves some work to the moment a feature is first used, which has to stay within the interaction budgets.

## Alternatives considered

- **A monolith with feature flags:** simple, but disabled code is still bundled, parsed and often initialized.
- **Runtime plugins loaded from disk:** maximum flexibility, but a large security surface and a signing problem; extensions are a separate topic for M4.
- **One package per module:** strong isolation, but heavy workspace overhead for a team of three.
- **Dependency injection without manifests:** activation would work, but settings, policies and documentation could not be generated without loading every module.
