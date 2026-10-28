# 0019. License: MPL-2.0

## Status

Accepted

## Date

2026-10-25

## Context

Astela needs an open source license before its first release, and changing it later would require the consent of every contributor. The license should keep improvements to Astela's own code open, let organizations package, customize and combine the browser with their own components without legal friction, and fit the dependencies: Electron under MIT, Chromium under BSD-style licenses, `@ghostery/adblocker` under MPL-2.0 ([ADR 0018](0018-content-blocker-engine.md)) and Lucide under ISC ([ADR 0024](0024-icons-and-typography.md)). Filter lists under GPL and CC BY-SA are distributed as separate data files.

Two candidates were close. GPL-3.0-or-later would protect the whole browser against closed forks and would allow the GPL-3.0 library `electron-chrome-extensions` for extension support. MPL-2.0 applies copyleft per file and is the license of Firefox and of Firefox-based browsers such as Zen and Floorp.

## Decision

Astela is licensed under the Mozilla Public License 2.0.

- **File-level copyleft:** whoever distributes modified Astela files must make those files available under MPL-2.0. New, separate files in a larger work may use other licenses.
- **Compatible with GPL combinations:** Astela does not attach Exhibit B ("Incompatible With Secondary Licenses"), so its code may be combined into larger works under GPL-2.0 or later, LGPL-2.1 or later and AGPL-3.0 or later, as section 3.3 of the license allows.
- **Notice:** the full license text is in the `LICENSE` file at the repository root. Source files carry no per-file headers; Exhibit A allows the notice to be placed in a location such as a `LICENSE` file where a recipient would be likely to look for it. Packages ship the license together with the third-party notices.
- **Contributions** are accepted under the same license, as stated in `CONTRIBUTING.md`; there is no separate contributor agreement.
- **Dependencies** will be checked against a license allowlist in CI as part of `ci-gate`. Libraries that would put the distributed browser under a stronger copyleft than MPL-2.0 are not used.
- **Trademarks:** MPL-2.0 grants no rights to names or logos (section 2.3). The product name and logo stay outside the license grant; the name is kept in `brand.json`.
- **Extensions (M4):** `electron-chrome-extensions` is not used, because it is licensed under GPL-3.0. Extension support is built on Electron's built-in extension support with Astela's own `chrome.*` API shims and its own CRX3 signature verification, for a curated list of compatible extensions ([roadmap](../roadmap.md)).

## Consequences

Positive:

- Changes to Astela's own files stay open, while organizations can add separate components under their own terms.
- The code can still be used in GPL projects, and the license fits the dependency set.
- Browser vendors, distributions and legal departments already know the license from Firefox and its derivatives.
- One `LICENSE` file keeps license handling simple for contributors.

Negative:

- Protection against closed forks is weaker than with the GPL: a fork can keep its own new files closed.
- Extension support needs more of Astela's own code in M4, and the list of supported extension APIs is expected to start smaller than with the GPL library.
- Without per-file headers, a file copied out of the repository does not carry its notice; copies have to keep the `LICENSE` file with them.

## Alternatives considered

- **GPL-3.0-or-later:** would allow `electron-chrome-extensions` and protect against closed forks, but puts the whole browser under strong copyleft, which makes combinations with organizations' own components harder. The library has also had no release since July 2025 and shows Manifest V3 regressions.
- **MIT or Apache-2.0:** widest adoption, but changes to Astela's own files could be kept closed.
- **AGPL-3.0:** its network clause adds nothing for a desktop application and discourages use in organizations.
- **Dual licensing:** needs a contributor agreement and legal overhead that a team of three cannot carry.
