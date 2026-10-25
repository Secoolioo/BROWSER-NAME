# 0011. Settings schema as single source

## Status

Accepted

## Date

2026-10-25

## Context

Customization is a core principle of Astela, so it has many settings, and every one of them appears in several places: the settings page with search, the stored user file, export and import, the JSON Schema for editors, the user and admin documentation, and the policy templates for Windows (ADMX/ADML), macOS (configuration profiles) and Linux (JSON). Every setting must also be settable and lockable by policy. Maintaining these outputs by hand would let them drift apart within a few releases.

## Decision

Each setting is defined exactly once, in the module that owns it, and every other representation is generated from that definition.

```ts
export const tabsPosition = defineSetting({
  key: 'tabs.position',
  type: enumOf(['top', 'bottom', 'left', 'right']),
  default: 'top',
  scope: 'global',
  policy: { name: 'TabStripPosition', recommendedAllowed: true },
  ui: { section: 'appearance', control: 'segmented', keywords: ['tab bar', 'vertical tabs'] },
  restartRequired: false,
});
```

- Definitions live in the modules' `*.contrib.ts` files, so generators and the settings page can read them without loading feature code ([ADR 0010](0010-module-system-and-lazy-loading.md)).
- Types are Valibot schemas ([ADR 0007](0007-ipc-contracts-and-validation.md)); typed setting keys and values are derived from them.
- The scope is `global` or `workspace`.
- **Resolution order:** default < recommended policy < user value < workspace override < mandatory policy. `inspect(key)` returns the effective value, its source and whether it is locked.
- **Policies:** every setting with a `policy` attribute is automatically a policy. Locked values cannot be changed through the UI or the API, and the UI shows them with a lock and the label "Managed by your organization".
- **Settings page:** generated from the schema, with search over titles, descriptions, keywords and synonyms in every shipped language, deep links such as `app://settings/#tabs.position`, and a "Modified" view that lists differences from the defaults.
- **Storage:** user values live in `settings.json` with a `$schemaVersion`. Writes are debounced and atomic (temporary file, `fsync`, rename). Invalid keys are moved to `settings.rejected.json`; nothing is deleted.
- **Export and import:** JSON with version and schema checks, never containing secrets.
- **Generated artifacts:** `settings.schema.json`, typed keys, the settings reference in the documentation, ADMX/ADML (en-US and de-DE), a `.mobileconfig` example, and the schema and an example for the Linux `policies.json`; a Jamf JSON schema follows in M2.
- Generated artifacts are not committed. They are built in CI, published as release assets and deployed to the website. A drift check ensures that the generators are deterministic.

## Consequences

Positive:

- A new setting needs one definition to appear in the UI, the search, the documentation, the JSON Schema and every policy template.
- Administrators can rely on templates that always match the shipped version.
- Typed keys turn a misspelled setting into a compile error.
- The resolution order and `inspect` make every value explainable, in the UI and on the diagnostics page.

Negative:

- The generators are significant infrastructure that the team builds and maintains, with tests for each output format.
- Settings that need a custom control still need hand-written UI code, registered through the `ui` metadata.
- Policy names become a public interface: once released, a policy name cannot be changed without a migration path for administrators.

## Alternatives considered

- **Hand-written settings page, documentation and templates:** no generators, but drift between the outputs is almost certain.
- **JSON Schema as the source:** good tooling, but types and runtime validation would need extra generation steps, and UI metadata does not fit the schema format well.
- **A generic store library such as electron-store:** handles persistence only and offers no policy layers, resolution order or generated outputs.
- **Settings defined centrally instead of per module:** one file to read, but disabling a module would no longer remove its settings, and ownership would blur.
