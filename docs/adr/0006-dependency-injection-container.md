# 0006. Dependency injection container

## Status

Accepted

## Date

2026-10-25

## Context

Lampo is structured as a microkernel with feature modules ([ADR 0010](0010-module-system-and-lazy-loading.md)) and a ports-and-adapters split: the `domain` layer defines ports such as `IFileSystem`, `IKeyStore`, `IRegistry` and `IClock`, and the `platform` layer implements them for Electron, Node and each operating system. Services need their dependencies wired from one composition root, tests need to replace adapters with in-memory versions, and objects have different lifetimes: some live as long as the app, some as long as a window, some as long as a module is active.

The common dependency injection libraries for TypeScript, such as tsyringe and InversifyJS, read constructor types at runtime through `reflect-metadata` and legacy decorators. The toolchain in [ADR 0004](0004-typescript-toolchain-and-build.md) allows neither.

## Decision

Lampo uses its own small, typed dependency injection container in `kernel/di`, without reflection and without decorators.

- Dependencies are identified by typed tokens created with `token<T>(name)`. The token carries the type, so `resolve` returns the correct type without casts.
- Classes declare their dependencies in a static `inject` list and receive them through the constructor. Factories and constant values can be registered as well.
- Each registration has a lifetime. Containers form a tree of scopes: one app container, a child container per window and a child container per active module.
- `createChild()` creates a scope; `dispose()` releases everything the scope created, in reverse order of creation.
- Cyclic dependencies and missing registrations fail at resolution time with the chain of tokens involved.
- Only the composition root in `main/` and the module host register services; other code receives its dependencies and never resolves from the container directly.
- The container is expected to stay at around 200 lines of code with no runtime dependencies.

```ts
export const SETTINGS = token<ISettingsService>('settings');
export const EVENT_BUS = token<EventBus>('event-bus');

export class TabService implements ITabService {
  static readonly inject = [SETTINGS, EVENT_BUS] as const;

  readonly #settings: ISettingsService;
  readonly #events: EventBus;

  constructor(settings: ISettingsService, events: EventBus) {
    this.#settings = settings;
    this.#events = events;
  }
}
```

## Consequences

Positive:

- The container adds no bundle cost beyond its own small source and has no dependency on runtime type information.
- Tests can build a container with in-memory adapters, which keeps unit tests of `domain`, `kernel` and module logic fast and deterministic.
- Module scopes give every feature module a clean lifetime: deactivating a module disposes everything it created.
- Dependencies stay visible in each class's `inject` list, which makes reviews and architecture checks straightforward.

Negative:

- The `inject` list repeats the constructor parameters. The container's typings have to link the two so that a wrong order or type becomes a compile error.
- The team maintains this piece of infrastructure itself, including documentation and tests.
- Developers familiar with decorator-based containers have to learn a different style.

## Alternatives considered

- **tsyringe or InversifyJS:** mature, but they depend on `reflect-metadata` and legacy decorators, which the toolchain does not support.
- **Manual wiring without a container:** no infrastructure, but scopes, disposal and test replacement would be reimplemented in many places.
- **Service locator or module-level singletons:** hidden dependencies, no scoping and hard-to-isolate tests.
- **A third-party container without decorators:** possible, but the needed feature set is small enough that an extra dependency brings little benefit.
