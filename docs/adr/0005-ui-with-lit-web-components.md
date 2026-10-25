# 0005. UI with Lit web components

## Status

Accepted

## Date

2026-10-25

## Context

The browser UI consists of the shell (toolbar, tab strip, sidebar), the overlay (menus, command palette, omnibox suggestions, prompts) and the internal pages such as settings, history and the theme editor. It has to start fast, stay small, respond to frequent state patches from the main process, and adapt to themes through design tokens ([ADR 0013](0013-theme-system-and-design-tokens.md)). The start chunk of the UI is limited to 300 KB minified and all UI code to 1 MB ([ADR 0017](0017-performance-budgets-in-ci.md)). Every page served from `app://` runs under a strict Content Security Policy with Trusted Types ([ADR 0008](0008-internal-pages-via-app-protocol.md)).

The code style of the project favors small classes behind interfaces. The toolchain in [ADR 0004](0004-typescript-toolchain-and-build.md) allows erasable syntax only: Vite 8 with Oxc cannot lower standard decorators, and Node type stripping does not support them, so decorator syntax would break either the build or the tests.

## Decision

The UI is built from class-based web components using Lit 3, without decorators.

- Reactive properties are declared with `static properties` and typed with `declare` fields; there is no `@customElement`, `@property` or `@state`.
- Elements are registered explicitly with `customElements.define`.
- Trivial leaf elements without reactive state are plain `HTMLElement` subclasses.
- Shared base classes, design tokens and controls live in `ui/ui-kit`; the shell, overlay and pages compose them.
- Styles use Shadow DOM and read colors, spacing and motion only from CSS custom properties defined by the design tokens.
- Feature modules contribute UI through their own lazily loaded chunks ([ADR 0010](0010-module-system-and-lazy-loading.md)).

```ts
import { LitElement, html } from 'lit';

export class TabItem extends LitElement {
  static override properties = {
    title: { type: String },
    active: { type: Boolean, reflect: true },
  };

  declare title: string;
  declare active: boolean;

  constructor() {
    super();
    this.title = '';
    this.active = false;
  }

  override render() {
    return html`<span class="title">${this.title}</span>`;
  }
}

customElements.define('lampo-tab-item', TabItem);
```

## Consequences

Positive:

- Lit adds about 6 KB gzipped, which leaves almost the whole UI budget to Lampo's own code.
- Components are standard custom elements, so they work without a framework runtime and are easy to test in a real browser engine with Vitest Browser Mode and axe-core ([ADR 0022](0022-test-strategy.md)).
- Lit's templates render without `eval`, which fits the strict CSP and Trusted Types of the internal pages.
- The class-based model matches the rest of the codebase and the dependency injection style.

Negative:

- Without decorators, components are slightly more verbose: each reactive property is listed once in `static properties` and once as a `declare` field.
- Most Lit examples and documentation use decorators and have to be translated.
- Shadow DOM requires care for focus handling, accessibility labels across shadow roots and global keyboard navigation.

## Alternatives considered

- **Lit with decorators:** the most common Lit style, but the toolchain cannot compile standard decorators, and legacy decorators violate the erasable syntax rule.
- **React or Preact:** larger runtime (React) or a virtual DOM and a JSX transform in the build, and a function-component model that differs from the rest of the codebase.
- **Svelte or Solid:** small output, but a framework compiler with its own syntax in the build chain.
- **Stencil:** relies on decorators and its own compiler.
- **Plain custom elements everywhere:** no dependency, but templating and reactive updates would be reinvented; plain `HTMLElement` stays the choice for trivial leaves only.
