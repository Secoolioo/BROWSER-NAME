# Design system

> **Status:** partly implemented. The first design tokens exist; the rest of this page is design. See [implementation status](#implementation-status).

The design system keeps every surface of Astela consistent, readable and calm. It consists of the design rules below, a small set of design tokens, fixed scales and automated checks that CI runs.

The decisions behind it are recorded in ADR 0013 (theme system and design tokens) and ADR 0024 (icons and typography). See the [decision records](../adr/README.md). Themes, which override tokens, are described in [Settings, policies and themes](settings-policy-theme.md). The calm, distraction-free character of the UI follows from the [principles](principles.md).

## Design rules

Astela should look like carefully made desktop software, not like a template. These rules apply to the browser UI, the internal pages, the website, the README and the brand assets.

- **Shape:** corner radii are small and uniform: 4 px for controls and at most 6 px for larger surfaces. There are no pill-shaped buttons and no strongly rounded cards.
- **Color:** flat, restrained colors with one accent color. There are no gradients anywhere, including the logo, page headers and text. The accent is not a generic purple or indigo.
- **Depth:** 1 px lines and differences in surface color separate areas. There are no glow or neon effects, no glass or blur effects and no large soft shadows.
- **Hierarchy:** comes from typography (size, weight and spacing), not from effects. Sizes and spacing follow a dense 4 px grid, with 8 px steps for larger gaps.
- **Icons:** one icon set with one stroke width. There are no emojis, no sparkle symbols, and no decorative blobs or generic illustrations.
- **Platform:** the native window controls, menus, context menus and shortcuts of each operating system are respected.
- **Motion:** only where it helps to follow a change, at most 150 ms long, and off when the system asks for reduced motion.
- **Website:** no standard landing page layout (a centered hero with gradient text above a grid of icon cards). It shows real screenshots of the browser, never mockups.
- **Writing:** factual and brief. No marketing phrases, no emoji lists, and dashes only where a sentence needs them.

## Design tokens

Design tokens are the only source for colors, spacing, radii, borders and motion. They live in the UI kit (`app/src/ui/ui-kit/tokens`) and reach every surface as CSS custom properties: the shell, the overlay and the internal pages.

- Components use tokens and contain no hard-coded colors, sizes or durations.
- Themes override tokens and nothing else. A theme can never restyle a component directly.
- Density and typography are settings that act through tokens.

## Color

All colors are defined in OKLCH. The palette consists of:

- an accent color,
- neutral grays in 11 steps,
- status colors.

The final values will be set together with the logo in the brand assets (`assets/brand/palette.json`). Hover, pressed and disabled states are not defined by hand; the theme engine derives them in OKLCH from the base tokens.

Every text and UI color pair has to meet these contrast minimums, in line with WCAG 2.2 AA:

| Element                        | Minimum contrast |
| ------------------------------ | ---------------- |
| Text                           | 4.5:1            |
| UI components and their states | 3:1              |

The built-in themes (Light, Dark and three original themes) must all meet these minimums. The theme editor is designed to warn live when a custom theme falls below them. The UI is also designed to stay usable in Forced Colors mode, which is part of the accessibility baseline.

## Density

Astela is designed to offer three density levels. Density is a setting and changes the toolbar and tab heights; the spacing grid stays the same.

| Density     | Toolbar height | Tab height | Spacing grid |
| ----------- | -------------- | ---------- | ------------ |
| Compact     | 32 px          | 28 px      | 4 px         |
| Normal      | 40 px          | 32 px      | 4 px         |
| Comfortable | 48 px          | 40 px      | 4 px         |

At every density, click targets must be at least 24 × 24 px, as required by WCAG 2.2.

## Typography

The UI uses the system font stack. It costs no download size and looks native on every platform.

| Platform | UI font             |
| -------- | ------------------- |
| Windows  | Segoe UI Variable   |
| macOS    | SF Pro              |
| Linux    | Cantarell or Ubuntu |
| Fallback | `system-ui`         |

The size scale has five steps: 12, 13, 14, 16 and 20 px. The UI font and its size are settings; the default fonts for web content are separate settings. The wordmark on the website is an SVG.

## Icons

- UI icons come from Lucide, which is published under the ISC license (as of October 2026).
- Icons are used at 16 and 20 px with a 1.5 px stroke.
- Only the icons the UI actually uses are bundled.
- The logo and the app icon are Astela's own. No third-party marks are used.

## Motion

- Durations are at most 150 ms; the default is 120 ms.
- Animations use only `transform` and `opacity`, so they never trigger layout.
- When the system requests reduced motion (`prefers-reduced-motion`), animations are off.
- No timers run while the browser is idle, which keeps idle CPU within its budget (see [Performance](performance.md)).

## Layouts

### Tab bar positions

The tab bar can sit on any of the four sides of the window. Each position has a reference layout that defines how the shell arranges itself around the web content:

| Position | Orientation | Reference layout                                                                                  |
| -------- | ----------- | ------------------------------------------------------------------------------------------------- |
| Top      | Horizontal  | Tab bar at the top of the window, above the web content. This is the default for `tabs.position`. |
| Bottom   | Horizontal  | Tab bar at the bottom of the window, below the web content.                                       |
| Left     | Vertical    | Tab bar along the left edge, with a collapsible width.                                            |
| Right    | Vertical    | Tab bar along the right edge, with a collapsible width.                                           |

The layout manager computes the bounds of the web content from the tab bar position, the sidebar, the density, compact mode and full screen; the shell reports its insets to it. Changing the position is designed to apply live, without a restart.

In every position, the tab bar is designed to be fully operable by keyboard, and F6 cycles focus from the toolbar to the tabs to the content.

### Layout presets

Presets give users a good layout without having to assemble it from individual settings:

- Classic
- Vertical left
- Vertical right
- Bottom
- Compact

On first start, the new tab page is designed to offer the choice of presets without a modal dialog; the settings offer it later as well. After choosing a preset, users can adjust every part of the layout freely. Each preset has a reference layout as well.

## Logo brief

The logo is designed to be:

- a geometric, distinctive mark of its own,
- legible at 16 px and in a single color,
- accompanied by a separate wordmark,
- free of any resemblance to the logos of other browsers.

The brand assets are designed to live in `assets/brand/`: `logo.svg`, `logo-mark.svg`, `wordmark.svg`, `palette.json`, `banner.svg` and the social preview image (`social-preview.svg` and `.png`).

## Acceptance

Design quality will be checked automatically in every pull request and reviewed by maintainers once per minor release.

Automated checks:

- **Contrast:** every built-in theme is checked against the contrast minimums above.
- **Accessibility:** axe-core runs in component and end-to-end tests and must report no serious or critical issues. Accessibility tree snapshots serve as regression tests.
- **Screenshot diff:** screenshots of all four tab bar positions in light and dark are generated in every pull request and compared with the reference. Each layout preset is compared with its reference layout the same way.

Design review: once per minor release, maintainers review the generated screenshot gallery (all tab bar positions, light and dark) against the design rules and approve it.

How these checks fit into the overall test strategy is described in [Testing](testing.md).

## Implementation status

The first tokens exist in `app/src/ui/ui-kit/tokens.css`: OKLCH colors for light and dark mode, spacing, radii and motion, with motion switched off for `prefers-reduced-motion`. The shell uses them, with inline Lucide-style icons. The application icon, the single-color mark and the wordmark exist in `assets/brand/` and are described in its README. The website applies the same rules to its documentation theme in `website/src/styles/theme.css`.

Not implemented yet: `palette.json`, the banner and the social preview image, density levels, font settings, the tab bar positions, layout presets, the built-in themes and the automated contrast, accessibility and screenshot checks.
