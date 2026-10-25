# Maintainer workflow

This document is the single source of truth for how changes reach users: branches, pull requests, checks, versions, releases and the Definition of Done. Other documents link here instead of repeating it.

## Team

Lampo is maintained by a team of three. The repository owner administers settings and secrets; all maintainers write code and review each other's work. Every commit is authored by the maintainer who wrote it, using a GitHub noreply address.

## Branches and commits

- `main` is always releasable. Nobody pushes to it directly; changes land through pull requests and squash merges only.
- Work happens on short-lived branches (at most a few days) named `<type>/<short-description>`, with `<type>` one of `feat`, `fix`, `perf`, `refactor`, `docs`, `test`, `build`, `ci`, `chore`. Example: `feat/vertical-tab-strip`.
- Commit messages and pull request titles follow [Conventional Commits](https://www.conventionalcommits.org/). Breaking changes use `!` in the header (`feat(settings)!: …`).
- Commit messages contain no trailers or footers. The `commit-msg` hook and CI enforce this.
- One pull request has one author. The squash commit on `main` keeps that author.
- The pull request title becomes the squash commit message, so it must be a valid Conventional Commit.

## Pull requests

- **Owner branches:** pushing a branch with one of the prefixes above runs the `Branch push` workflow. When it passes, `Open pull request` opens the pull request from the first commit message and enables squash auto-merge. It merges once every required check is green.
- **Other maintainers** open pull requests themselves; the owner reviews them.
- **Required checks:** `ci-gate` (all CI jobs) and `pr-title`. Review conversations must be resolved. Only green pull requests are merged.
- **Size:** keep pull requests small, roughly 400 changed lines of hand-written code. Generated files and lockfiles do not count.
- **Description:** what changes and why, plus the related issue. The Definition of Done below applies; the template only links here.

## Local checks

```sh
pnpm install   # also installs the git hooks
pnpm verify    # every check CI runs in the verify job
```

`pnpm verify --only <name>[,<name>]` runs a subset. Run the full command before pushing.

## Dependencies

- Dependencies are updated by maintainers in regular `chore(deps): …` pull requests (at least monthly) and immediately for security fixes. Dependabot alerts are enabled; automated update pull requests are not used.
- Versions are pinned exactly. GitHub Actions are pinned by commit SHA with the tag as a comment.
- Packages that may run install scripts are listed under `allowBuilds` in `pnpm-workspace.yaml`. Everything else is blocked.
- A new dependency needs a reason in the pull request. Anything larger than 20 KB gzipped in the browser UI, or with native code, needs an architecture decision record.

## Versions

- [Semantic Versioning](https://semver.org/) starting at `0.1.0`. Before `1.0.0`, a MINOR bump carries features or breaking changes and a PATCH bump carries fixes.
- Prereleases are `X.Y.Z-beta.N` and are delivered on the beta channel. Linux packages encode them as `X.Y.Z~beta.N` so that they sort before the final release. MSI packages are built for stable releases only.
- Data and settings formats have their own schema versions, independent of the app version. Every schema change ships with a migration and a test against stored profiles of earlier releases.

## Automation status

| Workflow                         | Purpose                                                              | Status                            |
| -------------------------------- | -------------------------------------------------------------------- | --------------------------------- |
| `ci.yml`                         | `verify`, commit rules, workflow security, `ci-gate`                 | active                            |
| `pr-title.yml`                   | pull request title lint                                              | active                            |
| `branch-push.yml`, `auto-pr.yml` | owner pull requests with auto-merge                                  | active                            |
| `labels.yml`                     | label sync from `.github/labels.yml`                                 | active                            |
| `codeql.yml`, `scorecard.yml`    | code scanning and OpenSSF Scorecard                                  | active                            |
| `repo-setup.yml`                 | applies repository settings from `tools/owner/setup.sh` (owner only) | active                            |
| `release.yml`, `pages.yml`       | packages, release, website, update feeds, package repositories       | arrives with the release pipeline |

## Releases

1. On a branch `chore/release-x.y.z`, prepare the release: bump the version, update `CHANGELOG.md` from the Conventional Commits since the last release and curate it, and update version references in the documentation.
2. Merge the pull request `chore(release): vX.Y.Z`.
3. The release pipeline then runs on `main`:
   - It builds every package on native runners and smoke-tests each one.
   - It runs the updater tests, then signs and attests the artifacts and uploads them to a draft release.
   - It publishes the release, which creates the tag.
   - It deploys the website, documentation, update feeds and package repositories.
   - It verifies the live result.
4. A failed run is resumed with `workflow_dispatch`. Published releases and their tags are immutable. If a published release is wrong, ship the next patch version instead.

## Definition of Done

Every update delivered to users meets all of these:

- [ ] `pnpm verify` passes locally and `ci-gate` is green on all three operating systems, including package smoke tests, updater tests, performance budgets and security scans.
- [ ] Documentation (user, admin, developer, architecture, decision records where affected) and `CHANGELOG.md` are updated.
- [ ] The version is bumped according to the rules above.
- [ ] Everything is merged into `main`.
- [ ] A GitHub release exists with all packages for all supported platforms and architectures, release notes, `SHA256SUMS` with signature, SBOM and attestations.
- [ ] The website and documentation are live and current (version, changelog, screenshots, API reference).
- [ ] The update feeds and package repositories are live and signed, and live verification passed, so installed browsers receive the update.
- [ ] A short release summary is shared with the team: version, changes, links, and any action needed from a maintainer.

## Checks per minor release

Some checks need people. Maintainers other than the release author do them once per minor release (not per patch) and note the result in the release pull request:

- Screen reader smoke test with NVDA (Windows), VoiceOver (macOS) and Orca (Linux).
- Import of the ADMX templates into a Microsoft Intune test tenant.
- Design review of the generated screenshot gallery (all tab bar positions, light and dark).
- Google account sign-in after every Electron major upgrade.

## Security

- Vulnerabilities are handled as described in [SECURITY.md](../../SECURITY.md).
- Response times:

  | Event                                | Response                                                           |
  | ------------------------------------ | ------------------------------------------------------------------ |
  | Security fix in Electron or Chromium | Patch release within 72 hours; target 24 hours for critical issues |
  | New Electron major version           | Upgrade within two to four weeks                                   |

- Release and automation secrets are stored in the GitHub environments `release` and `automation`, which only `main` may use. Pull request and branch workflows never see them.
- Signing keys have an encrypted offline backup kept by the owner. Key rotation is documented together with the release pipeline.

## Renaming the product

All product names and identifiers come from `brand.json`. To rename the product, change that file, apply the change everywhere it is used, and search the repository for the old name until nothing is left. The release that ships a new name must migrate user data, settings and package names automatically.
