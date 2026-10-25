# Contributing to Lampo

Thank you for helping to build Lampo. This page covers the essentials; the complete process, including the Definition of Done, lives in [docs/maintainers/WORKFLOW.md](docs/maintainers/WORKFLOW.md).

## Before you start

- Look for an existing issue first. For anything larger than a small fix, open an issue (bug, feature or docs) and agree on the approach before writing code.
- Never report security vulnerabilities in public issues. Follow [SECURITY.md](SECURITY.md).

## Development setup

You need Node.js 24 (see [`.node-version`](.node-version)) and pnpm 12 (pinned in `package.json`).

```sh
pnpm install   # installs dependencies and git hooks
pnpm verify    # runs every check that CI runs
```

## Making changes

- Branch names: `<type>/<short-description>`, for example `fix/tab-drag-flicker`.
- Commits and pull request titles: [Conventional Commits](https://www.conventionalcommits.org/), without trailers. The git hooks check this for you.
- Code: TypeScript in strict mode, small classes behind interfaces, and a doc comment on every public class, method and function.
- Tests: every change ships with tests at the right level (unit, integration or end-to-end).
- Keep pull requests small and focused; one author per pull request.

## License

Lampo is licensed under the [Mozilla Public License 2.0](LICENSE). By contributing, you agree that your contributions are licensed under the same terms.
