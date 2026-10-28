# 0007. IPC contracts and validation

## Status

Accepted

## Date

2026-10-25

## Context

The main process talks to three kinds of renderer views: the shell of each window, the overlay, and internal pages such as `app://settings`. Every message that crosses this boundary is untrusted input for the main process, because a compromised renderer could send anything. At the same time, the UI needs a typed, ergonomic way to call the main process and receive state updates.

Validation also appears outside IPC: settings, themes and update feeds are loaded from files or the network and must be checked against a schema, and the settings and theme schemas are published as JSON Schema for editors and administrators. All `app://` pages run under a strict Content Security Policy that forbids `eval` and `new Function`.

## Decision

Every IPC channel is declared as a contract in `shared/contracts`, and Valibot 1.5 is the schema library for contracts, settings, themes and feeds.

```ts
import * as v from 'valibot';

export const openTab = defineIpc({
  channel: 'tabs.open',
  request: v.object({ url: v.pipe(v.string(), v.url()), background: v.boolean() }),
  response: v.object({ tabId: TabIdSchema }),
  capability: 'shell',
});
```

- **Router in main:** the `IpcRouter` runs a middleware chain for each message: (1) the sender must be a registered shell, overlay or internal view, checked through `event.senderFrame`, with an `app://` origin and as the top-level frame; (2) the view must hold the contract's capability; (3) the payload must match the request schema; (4) a per-channel rate limit applies. Messages that fail any step are dropped and logged locally.
- **Preloads:** each view type gets its own minimal preload that exposes only `invoke(channel, payload)` and `subscribe(event)` for the channels its capability allows. The generic `ipcRenderer` is never exposed. A typed client is generated from the contracts.
- **Capabilities:** internal pages receive only the channels they need, for example `page:settings` for the settings page. Web tabs have no preload and no IPC access; the only planned exception is the content blocker's frame preload in M2, which receives its cosmetic rules over a validated IPC contract ([ADR 0018](0018-content-blocker-engine.md)).
- **No synchronous IPC:** state flows from main to the UI as a snapshot followed by patches, batched per animation frame.
- **JSON Schema:** `@valibot/to-json-schema` generates the published JSON Schemas for settings and themes from the same Valibot definitions ([ADR 0011](0011-settings-schema-as-single-source.md)).
- **Fuzzing:** property-based tests with fast-check send invalid payloads to every contract ([ADR 0022](0022-test-strategy.md)).

## Consequences

Positive:

- Valibot validates without `eval` or `new Function`, so the same schemas run under the strict CSP in renderers and in the main process.
- Valibot's modular design keeps the bundle small, because only the validators in use are included.
- Valibot implements Standard Schema, so other tools that accept Standard Schema can reuse the contracts.
- One contract definition provides the runtime check, the static types for both sides and the generated client, so the two ends cannot drift apart.
- Capabilities limit the damage a compromised page can do to the channels that page legitimately uses.

Negative:

- Every new channel needs a contract, a capability and tests before it can be used, which adds friction for small features.
- Validation adds a small cost per message; batching patches per frame keeps the message count low.
- Valibot's functional, pipe-based API is less familiar than chained schema APIs and needs a short introduction in the developer documentation.

## Alternatives considered

- **Zod:** widely known, but larger, and its fastest validation path compiles code with `new Function`, which the CSP forbids.
- **Ajv with JSON Schema as the source:** compiles validators with `new Function` unless precompiled, and needs separate type generation.
- **TypeBox or ArkType:** good typing, but their fast paths also rely on runtime code generation.
- **Hand-written type guards:** no dependency, but error-prone, and no JSON Schema output for settings and themes.
- **A generic RPC layer over IPC (for example tRPC adapters or Comlink):** convenient, but no per-view capabilities and sender checks without extra work.
