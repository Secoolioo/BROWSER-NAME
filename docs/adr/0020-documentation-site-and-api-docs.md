# 0020. Documentation site and API docs

## Status

Accepted

## Date

2026-10-25

## Validation

The first version of the site builds the landing page, every page of `docs/`, the changelog and the API reference. Notes from building it:

- `website/scripts/sync-docs.ts` turns `docs/` into pages at build time: the first heading becomes the title, links between Markdown files become links between pages, and links to other repository files point to GitHub. The synced pages are not committed.
- starlight-typedoc does not run TypeDoc's validation. `pnpm --dir website run check:api` therefore runs TypeDoc itself with `website/typedoc.json`, and the site build reads its options from the same file. Members inherited from third-party classes are left out (`excludeExternals`), and documentation is required for declarations and methods but not for every interface property.
- The website package depends on TypeScript 6.0.3 directly; no alias is needed because it is a separate workspace package.
- Mermaid diagrams are rendered in the browser. The Mermaid render check and the lychee link check arrive with `pages.yml`.
- Astro 7 needs Node.js 22.23.4 or later; the repository uses Node.js 24 (`.node-version`).

## Context

Lampo needs one public website for the landing page, downloads, feature pages, user, admin and developer documentation, the API reference and the changelog. The same GitHub Pages site also serves the signed update feed and the Linux package repositories ([ADR 0014](0014-update-architecture-with-signed-feed.md), [ADR 0015](0015-linux-package-repositories.md)). Documentation has to be versioned and reviewed with the code, every public class, method and function has to carry a doc comment, and nothing on the site may link to downloads that do not exist yet.

The app is checked with the native TypeScript 7 compiler, which does not offer a stable compiler API yet; TypeDoc and Astro's type checking still need TypeScript 6 ([ADR 0004](0004-typescript-toolchain-and-build.md)).

## Decision

The website is a workspace package `website/` built with Astro 7 and Starlight 0.42, with Pagefind for search and TypeDoc 0.28 through starlight-typedoc for the API reference.

- **Single source:** `docs/` holds all hand-written documentation: user, admin and developer guides, architecture, ADRs, the roadmap and the maintainer workflow. The website reads it at build time; no page is copied or maintained twice.
- **API reference:** TypeDoc runs with `entryPointStrategy: "expand"` over `app/src`, so every module is included, with `validation.notDocumented` and `treatWarningsAsErrors`. A missing doc comment on a public API fails the build.
- **TypeScript for tools:** TypeDoc and the Astro check use TypeScript 6.0.3 through a package alias in the `website` package until TypeScript 7.1 offers a stable API.
- **Generated, not committed:** the API reference, policy reference, ADMX and ADML templates and JSON Schemas are generated during the build, deployed to the website and attached to releases. A drift check keeps the generators deterministic.
- **Pages of the site:**

  | Path                                   | Content                                                                                                       |
  | -------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
  | `/`                                    | Landing page with real screenshots, feature highlights and a download button that detects OS and architecture |
  | `/download`                            | All packages of the current version with SHA-256, signature and attestation notes                             |
  | `/features/*`                          | Workspaces, customization, tabs, privacy, performance with CI measurements, enterprise                        |
  | `/docs/*`                              | User, admin and developer documentation with Pagefind search                                                  |
  | `/api/*`                               | TypeDoc reference                                                                                             |
  | `/changelog`                           | Rendered from `CHANGELOG.md`                                                                                  |
  | `/updates/v1/*`                        | Signed update feed, no HTML                                                                                   |
  | `/apt`, `/rpm`                         | Linux package repositories                                                                                    |
  | `/media/screenshots/{version,latest}/` | Screenshots from the release run                                                                              |

- **No dead links:** `/download` is generated from release data and does not exist until the first release. The download button uses `navigator.userAgentData.getHighEntropyValues` with a user agent string fallback and links to every other format. Pages about features that are not released yet carry "Available from vX.Y" and join the navigation only after that release.
- **Checks on every pull request:** strict TypeDoc, Markdown lint, a Mermaid render check, a link check with lychee and the Astro build ([ADR 0022](0022-test-strategy.md)).
- **Deployment:** `pages.yml` builds and deploys the whole site from the repository and release data ([ADR 0016](0016-release-pipeline-without-bot-commits.md)). The site is in English.

## Consequences

Positive:

- One build produces one site with shared navigation, search and design for guides, API and changelog.
- The API reference cannot drift from the code, and undocumented public APIs fail CI instead of slipping through review.
- Documentation changes are reviewed in the same pull request as the code they describe.
- The site is static: Pagefind searches without a server, and Pages hosts it without extra services.

Negative:

- Building the documentation is part of every pull request and adds CI time.
- Two TypeScript versions live in the workspace until TypeScript 7.1 is stable.
- Starlight is not at 1.0 yet, so upgrades may bring breaking changes.
- `notDocumented` requires doc comments even on self-explanatory public members.
- The site shares the Pages size and traffic limits with the APT repository.

## Alternatives considered

- **VitePress 2:** still in alpha.
- **Docusaurus:** brings a React toolchain into a repository whose UI uses Lit, and its API docs need a separate plugin chain.
- **TypeDoc's own HTML as a second site:** a separate navigation, design and search next to the guides.
- **MkDocs with Material:** adds a Python toolchain to a TypeScript workspace.
- **A repository wiki or README files only:** not versioned with the code and without an API reference.
