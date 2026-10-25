# 0013. Theme system and design tokens

## Status

Accepted

## Date

2026-10-25

## Context

Customization is one of Astela's core principles ([principles](../architecture/principles.md)). Users choose light, dark or system appearance and an accent color, import and export theme files, edit themes with a live preview and give each workspace its own theme. At the same time the interface has to stay readable and consistent: every built-in surface must meet WCAG 2.2 AA, and the generated screenshot gallery is reviewed for visual quality.

The browser UI is spread over several renderers: one shell view per window, a lazily created overlay view for menus and prompts, and internal pages such as `app://settings` ([ADR 0008](0008-internal-pages-via-app-protocol.md)). A theme change has to reach all of them at once. A workspace switch must not flicker, and a change in the theme editor must be visible in under 100 ms.

## Decision

Design tokens are the only source of visual values, and themes are data files that override tokens.

- **Tokens** live in `app/src/ui/ui-kit/tokens/` and cover colors, spacing, radii, shadows and motion. Components read them through CSS custom properties and contain no literal colors or sizes.
- **Colors** are defined in OKLCH. The brand palette has an accent, an 11-step neutral scale and status colors; its values are kept in `assets/brand/palette.json` next to the logo ([ADR 0024](0024-icons-and-typography.md)).
- **Theme files** (`*.theme.json`) contain `$schema`, `id`, `name`, `version`, `base` (`light` or `dark`), `tokens` and an optional `newTab` background. The tokens cover accent, surfaces, text, borders, focus, tab and toolbar specifics, radius and optional transparency or vibrancy. The format is a Valibot schema with a generated JSON Schema ([ADR 0007](0007-ipc-contracts-and-validation.md)). User themes are stored as `themes/*.theme.json` in the profile ([data](../architecture/data.md)).
- **Theme engine:** the `IThemeService` in the browser process resolves a theme, derives hover, pressed and disabled states in OKLCH and checks contrast against WCAG 2.2 AA (at least 4.5:1 for text, 3:1 for UI elements). It applies the resulting custom properties to the shell, the overlay and internal pages in the same frame.
- **Import and export:** imported files are validated against the schema and take effect immediately. Export writes a canonical file, so exporting and re-importing a theme is byte-identical.
- **Modes:** light, dark or system through `nativeTheme`. The accent comes from a preset, a free color, or the system accent on Windows and macOS.
- **Scopes:** a theme applies globally or to one workspace. Switching workspaces only swaps tokens and completes within one frame.
- **Density and fonts** are settings ([ADR 0011](0011-settings-schema-as-single-source.md)) that act through tokens. Density has three steps on a 4 px grid: compact (toolbar 32 px, tab 28 px), normal (40 px, 34 px) and comfortable (48 px, 40 px). Click targets are at least 24 × 24 px everywhere.
- **Motion** lasts 120–200 ms, animates only `transform` and `opacity`, and is switched off under `prefers-reduced-motion`.
- **Built-in themes:** Light, Dark and three original themes, all contrast-checked.
- **Theme editor** (`app://theme-editor`): a token list for colors and radius with live preview on the real window, a contrast display that warns below 4.5:1, file import and export, and duplication of built-in themes. Gradients, background images and a local theme gallery follow in later milestones ([roadmap](../roadmap.md)).
- The safe mode (`--safe-mode`) starts without user themes.

Acceptance is automated where possible: contrast and axe checks, plus screenshot diffs of all four tab bar positions in light and dark on every pull request ([ADR 0022](0022-test-strategy.md)). Maintainers review the screenshot gallery once per minor release. The details are described in [settings, policy and theme](../architecture/settings-policy-theme.md) and in the [design system](../architecture/design-system.md).

## Consequences

Positive:

- One token change is expected to update every surface consistently, which keeps restyling cheap.
- Themes are small, portable, schema-validated files that cannot inject code or arbitrary CSS into privileged pages.
- Derived states and contrast checks keep custom themes readable; the editor warns before a user saves an unreadable theme.
- Workspace switches stay instant because they only exchange custom properties.
- Density, fonts and accent use the same mechanism as every other setting, so policies can preset or lock them.

Negative:

- Token names become a public format. Renaming or removing a token needs a theme schema version and a migration, like any other stored data.
- Themes cannot change layout or arbitrary styles; deeper restyling requires new tokens.
- OKLCH derivation and contrast checking are project code that needs tests against every built-in theme.
- Applying tokens to several renderers in one frame needs coordination in the browser process.

## Alternatives considered

- **User CSS files in the style of `userChrome.css`:** maximum freedom, but they break with every UI change, cannot be checked for contrast and widen the attack surface of privileged pages.
- **Chrome-style theme manifests:** only a few colors and images; not enough for density, radius or per-workspace themes.
- **HSL or sRGB color math:** lightness steps are perceptually uneven, so derived hover and disabled states would need manual tuning per theme.
- **CSS-in-JS or a utility CSS framework:** adds runtime or build complexity without improving theming; custom properties already inherit into the shadow roots of Lit components ([ADR 0005](0005-ui-with-lit-web-components.md)).
- **One stylesheet per theme:** every theme would duplicate component styles, and themes would drift apart over time.
