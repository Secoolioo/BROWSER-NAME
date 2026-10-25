# 0001. Record architecture decisions

## Status

Accepted

## Date

2026-10-25

## Context

Astela is a desktop browser built by a team of three maintainers. Many of its foundations are hard to reverse once the first release ships: the engine embedding, the package formats, the update chain, the data formats and the policy paths that administrators configure. A small team also carries a real bus factor, so the reasons behind these choices must not live only in people's heads or in closed pull requests.

The project already has rules that depend on written decisions. A new dependency that adds more than 20 KB gzipped to the browser UI, or that brings native code, needs a decision record (see [WORKFLOW.md](../maintainers/WORKFLOW.md)). Special solutions that bypass the architecture rules are not accepted without one either.

## Decision

Astela records every architecturally significant decision as an Architecture Decision Record (ADR), following the lightweight format described at [adr.github.io](https://adr.github.io/).

- ADRs live in `docs/adr/` as Markdown files named `NNNN-short-title.md`, numbered consecutively with four digits. Numbers are never reused.
- Each ADR covers exactly one decision and is written in English.
- Every ADR has the sections Status, Date, Context, Decision, Consequences and Alternatives considered. The [ADR index](README.md) shows the template and lists all records.
- The status is one of Proposed, Accepted, Deprecated or Superseded. A superseded ADR names its successor.
- Once accepted, an ADR is not rewritten. A changed decision gets a new ADR that supersedes the old one; the old record only receives the status change and a link.
- ADRs are added and changed through pull requests like code, with the same review rules.
- A pull request that changes an accepted decision, adds a dependency above the size threshold, adds native code, or changes the layer rules in [ADR 0021](0021-repository-layout-and-architecture-rules.md) includes the corresponding ADR.
- When an early validation disproves an accepted decision, the documented fallback is recorded as a new, superseding ADR before the code changes.
- The ADRs are published with the rest of the documentation on the project website ([ADR 0020](0020-documentation-site-and-api-docs.md)).

The [architecture documents](../architecture/overview.md) describe the system as it is meant to work; ADRs explain why it is built that way. The two link to each other instead of repeating content.

## Consequences

Positive:

- New maintainers and contributors can follow the reasoning behind each foundation without asking the people who made the decision.
- Revisiting a decision starts from the recorded context and alternatives instead of from scratch.
- Review of large changes becomes faster because the expected direction is written down.
- The Definition of Done in [WORKFLOW.md](../maintainers/WORKFLOW.md) can point to a concrete place for decision updates.

Negative:

- Writing an ADR adds effort to significant changes.
- Records can drift from reality if superseding decisions are not written; reviewers have to ask for them.
- The index has to be kept in sync with the files by hand.

## Alternatives considered

- **No written records:** the reasoning is lost with every closed pull request and every change in the team.
- **Repository wiki:** not versioned together with the code and not reviewed through pull requests, so the project does not use one.
- **One large design document:** hard to review, and individual decisions cannot be superseded cleanly.
- **A formal RFC process:** too heavy for a team of three; ADRs give the same traceability with less ceremony.
