# 0024. Icons and typography

## Status

Accepted

## Date

2026-10-25

## Context

Lampo needs a recognizable identity of its own and a UI that feels native on Windows, macOS and Linux. Icons and fonts count against the UI size budgets ([ADR 0017](0017-performance-budgets-in-ci.md)), and every asset must have a clear license that fits MPL-2.0 ([ADR 0019](0019-license.md)). The UI shows icons at 16 and 20 px, workspaces pick an icon from a built-in set, and the logo must stay legible as a 16 px favicon and in a single color. The product name is kept in `brand.json` so that it can still change before 1.0.

## Decision

Lampo uses its own logo and wordmark, Lucide for UI icons and the system font stack for text.

- **Logo and wordmark:** an original, geometric mark that works at 16 px and in one color, with a separate wordmark and no resemblance to other browsers' logos. The sources will live in `assets/brand/` (`logo.svg`, `logo-mark.svg`, `wordmark.svg`, `palette.json`, `banner.svg` and the social preview), and the app icons for every platform will be produced from them in `app/build/`. A rename replaces the wordmark; the mark itself does not depend on the name.
- **UI icons:** [Lucide](https://lucide.dev/) under the ISC license. Icons are imported one by one, so only icons that the UI uses end up in the bundle. They are drawn at 16 and 20 px with a 1.5 px stroke and take their color from the theme tokens ([ADR 0013](0013-theme-system-and-design-tokens.md)). The workspace icon picker offers a curated subset of the same set.
- **UI font:** the system font stack, which costs zero bytes and matches each platform: Segoe UI Variable on Windows, SF Pro on macOS, Cantarell or Ubuntu on Linux, with `system-ui` as the fallback.

  ```css
  :root {
    --font-ui: 'Segoe UI Variable', Cantarell, Ubuntu, system-ui, sans-serif;
  }
  ```

  On macOS, `system-ui` resolves to SF Pro. The type scale is 12, 13, 14, 16 and 20 px. UI font and size are settings that act through tokens; default fonts for web content are separate settings ([ADR 0011](0011-settings-schema-as-single-source.md)).

- **Website:** the same system stack; the wordmark is an SVG, so the website loads no web font ([ADR 0020](0020-documentation-site-and-api-docs.md)).
- **No third-party marks:** the UI, the website, the screenshots and the test fixtures use no logos or brand marks of other products.
- **Attribution:** Lucide's license notice ships with the third-party notices of every package.

## Consequences

Positive:

- Text looks native on every platform and costs no download or start-up time.
- Only the icons in use reach the bundle, which keeps the UI start chunk small.
- One consistent icon set across shell, internal pages and workspaces.
- Licensing is clear: own artwork plus a permissive icon set.
- The design system details are described in one place ([design system](../architecture/design-system.md)).

Negative:

- Text metrics differ between platforms, so layouts have to tolerate different glyph widths.
- Linux systems without Cantarell or Ubuntu fall back to whatever `system-ui` resolves to.
- Icons missing from Lucide have to be drawn in the same style by the project.
- The logo, wordmark and app icons are maintained by the project, including every platform icon size.

## Alternatives considered

- **Material Symbols:** a distinctly Google visual language, usually delivered as a large icon font.
- **Font Awesome Free:** mixed licenses across icons, fonts and code, and its brand icons are third-party marks.
- **Other open icon sets such as Phosphor, Tabler or Heroicons:** suitable licenses; Lucide was chosen for the breadth of its outline set, and one set keeps the UI uniform.
- **Icon fonts:** ship every glyph, are hard to tree-shake and expose icons to screen readers as stray characters.
- **A bundled web font such as Inter:** adds bytes and load time and looks less native than the system font.
- **A custom icon set from the start:** a large design effort for a team of three; icons are referenced by name, so the set can still be replaced later.
