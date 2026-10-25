# 0016. Release pipeline without bot commits

## Status

Accepted

## Date

2026-10-25

## Context

Every change reaches users through `main` ([WORKFLOW.md](../maintainers/WORKFLOW.md)). A release produces many outputs: packages for every format and architecture, a GitHub release with signatures, SBOM and attestations, the website and documentation, the update feeds and the Linux package repositories. The history of `main` should contain only commits written by maintainers, with no bot accounts, no app badges and no generated commits for changelogs, websites or feeds.

Two security constraints shape the pipeline. Workflows that run branch code can read repository secrets, so signing keys and the owner token must be out of reach for branches and pull requests. And a release that users or mirrors have downloaded must never change afterwards.

Tools such as release-please, changesets and semantic-release solve versioning by opening bot pull requests or by pushing bot commits and tags.

## Decision

Pull requests, merges, releases and deployments run under the repository owner's account through GitHub features that create no commits.

- **Pull requests in two stages** (in place today): `branch-push.yml` runs on pushes to the prefixes `feat/`, `fix/`, `perf/`, `refactor/`, `docs/`, `test/`, `build/`, `ci/` and `chore/` and runs `pnpm verify` without any secrets. When it succeeds, `auto-pr.yml` starts through `workflow_run`. It always runs in its version on `main`, never checks out branch code, checks the actor and the branch prefix, and uses `OWNER_TOKEN` from the `automation` environment, which only `main` may use. The token is a fine-grained personal access token of the repository owner, so pull requests and merges show the owner, not a bot or an app.
- **Auto-merge** is enabled with the GraphQL mutation `enablePullRequestAutoMerge`: `mergeMethod: SQUASH`, the pull request title as `commitHeadline`, an empty `commitBody`, the owner's noreply address as `authorEmail`, and `expectedHeadOid` set to the verified head, so commits pushed later never merge unchecked.
- **Merge rules:** the `main` ruleset requires a pull request, the checks `ci-gate` and `pr-title`, resolved conversations, linear history and squash merges, and forbids force pushes and deletion. Titles and commits follow Conventional Commits without trailers, with one author per pull request. Other maintainers open their own pull requests; their workflows never see release secrets.
- **Release preparation is local:** `pnpm release:prepare <patch|minor|major|beta>` sets the version, generates the `CHANGELOG.md` section from the Conventional Commits with git-cliff (which also proposes the next version), updates version references in the documentation and creates the golden profiles for migration tests. A maintainer curates the result and merges it as `chore(release): vX.Y.Z`.
- **`release.yml`** runs on every push to `main` and on `workflow_dispatch`. When no published release exists for the version on `main`, it creates a draft release without a tag, builds all packages on native runners, runs smoke and updater tests, signs the artifacts, creates `SHA256SUMS`, SBOM and attestations, and renders the screenshots. Signing secrets come from the `release` environment, which only `main` may use. Without a version bump the workflow only deploys the website. Runs are idempotent; an interrupted run resumes on the existing draft through `workflow_dispatch`.
- **Tags:** publishing the complete draft with the owner token makes GitHub create the lightweight tag `vX.Y.Z`, without a tagger. Nobody pushes tags by hand. The `release-tags` ruleset blocks creating, moving and deleting `v*` tags; only the admin role, which the release job uses, bypasses it.
- **Immutable releases** are enabled: once published, the assets and the tag of a release cannot change. A faulty release is followed by the next patch version.
- **Pages deployment:** `release.yml` calls `pages.yml`, which also runs weekly and on demand. It builds the website from the repository and release data, re-signs the update feeds, signs the APT and DNF metadata, gates on a link check with lychee and deploys with GitHub's Pages deployment action. There is no `gh-pages` branch.
- **`verify-live`** checks the live result after every release: feed signatures, download links, and `apt` and `dnf` against the live repositories.
- **No bot pull requests for dependencies:** Dependabot alerts stay on, automatic security update pull requests are off. `freshness.yml` turns red when an Electron security release or a known vulnerability is pending, and a maintainer updates by hand.

All actions are pinned by commit SHA, every job has minimal `permissions`, and signing steps run only when their secrets exist, so unsigned builds pass through the same pipeline. Release secrets are described in [security](../architecture/security.md).

## Consequences

Positive:

- `main` contains only squash commits authored by maintainers; generated outputs live in releases and deployments.
- Signing keys and the owner token stay unreachable from branch and pull request code, even when a branch changes workflow files.
- One merge is expected to produce the complete release without manual steps, and resuming or re-running a release is safe.
- Published versions and tags cannot change, which users, package managers and mirrors can rely on.
- The changelog is curated by people instead of being copied from commit subjects.

Negative:

- The owner token is a single point of failure: when it expires, automatic pull requests and publishing stop. `freshness.yml` is meant to warn before that happens.
- The owner cannot approve their own pull requests, so review of owner changes is a team rule that GitHub does not enforce.
- With immutable releases every mistake costs a patch version, so drafts must be verified completely before publishing.
- Preparing a release needs a maintainer to run a local script; versioning is deliberately not fully automatic.
- The pipeline is custom workflow code that has to be maintained and hardened, with actionlint and zizmor in CI.

## Alternatives considered

- **release-please:** maintains a bot release pull request and pushes bot commits.
- **changesets:** needs a changeset file in every pull request and a bot pull request that bumps versions.
- **semantic-release:** pushes version commits and tags from CI and derives versions without human curation.
- **A `gh-pages` branch for website, feeds and repositories:** every deployment would be a generated commit.
- **A GitHub App for automation:** pull requests and merges would carry an app identity and badge.
- **Tags pushed by hand or by CI before the build:** a tag could point at a state that never became a complete release, and it could be moved.
- **Release secrets as repository secrets:** branch workflows could read them.
