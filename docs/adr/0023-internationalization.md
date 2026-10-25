# 0023. Internationalization

## Status

Accepted

## Date

2026-10-25

## Context

Astela ships its UI in English (`en`) and German (`de`) in M1, and every string in the UI, the settings search, native menus and the generated policy templates must exist in both. Adding a third language has to be possible without code changes. UI JavaScript has tight size budgets ([ADR 0017](0017-performance-budgets-in-ci.md)), and feature modules load lazily, so strings of a disabled module should not be loaded at all ([ADR 0010](0010-module-system-and-lazy-loading.md)).

Electron 45 ships Chromium 156 with the complete `Intl` API: `PluralRules`, `NumberFormat`, `DateTimeFormat`, `RelativeTimeFormat` and `ListFormat`, in the browser process and in every renderer.

## Decision

Astela uses the native `Intl` API with JSON message catalogs per locale and module, and no i18n runtime library.

- **Catalogs** live next to the code that uses them: every module has `locales/<locale>.json` (for example `modules/tabs/locales/en.json`). Catalogs load together with the module's chunk, so inactive modules never load their strings.
- **Messages** are strings with ICU-style `{name}` placeholders. Plural forms are selected with `Intl.PluralRules`; numbers, dates, relative times and lists are formatted with the matching `Intl` formatters for the active locale.
- **Typed keys:** `en.json` is the source locale. A generator creates TypeScript types for all keys and their placeholders from it, so an unknown key or a missing parameter fails the type check.
- **Completeness check:** a script in `pnpm verify` and CI checks that every key exists in every locale, that no orphaned keys remain and that placeholders match the source ([ADR 0022](0022-test-strategy.md)).
- **New locale = JSON only:** a new language consists of catalog files and nothing else. The test suite proves this with a pseudo-locale. The list of Chromium locale files shipped through electron-builder's `electronLanguages` is derived from the locales present, which keeps the package small without extra configuration per language.
- **Language selection:** the UI follows the system language and can be switched in the settings.
- **Shared use:** settings titles, descriptions and keywords come from the catalogs, so the settings search works in English and German, including synonyms ([ADR 0011](0011-settings-schema-as-single-source.md)). The generated ADML templates for `en-US` and `de-DE` use the same texts ([enterprise](../architecture/enterprise.md)).
- **MessageFormat 2** (the `messageformat` package) is adopted only if messages need more than placeholders and plurals, such as select or nested patterns. The catalog layout per module stays the same if it is adopted.

## Consequences

Positive:

- Nearly no runtime code for i18n, which helps the UI size budgets.
- Typos in keys and missing parameters are expected to fail at compile time instead of showing raw keys to users.
- Translators edit plain JSON files without special tooling.
- Formatting of numbers and dates follows the same locale data as web content in Chromium.
- Strings of disabled modules cost nothing.

Negative:

- No select or nested message patterns until MessageFormat 2 is adopted; messages have to be written to avoid them.
- The small formatter and the type generator are project code that needs tests.
- Translations arrive through pull requests; there is no translation platform yet.
- Many small catalog files have to be kept complete for every locale, which the CI check enforces.

## Alternatives considered

- **i18next:** adds a runtime library with its own plural and formatting layer on top of what `Intl` already provides.
- **FormatJS (`intl-messageformat`):** needs an ICU parser at runtime or a precompilation step, which is more than placeholders and plurals require.
- **Fluent:** its own syntax and runtime; translators and tooling would work outside plain JSON.
- **`@lit/localize`:** tied to Lit templates and a build-time transform, while the browser process also needs strings for menus and notifications.
- **MessageFormat 2 from the start:** powerful, but adds a parser at runtime before any message needs it; it remains the upgrade path.
