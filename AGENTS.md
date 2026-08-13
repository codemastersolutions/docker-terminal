# AGENTS.md

Guidance for OpenCode (and other agentic tools) working in this repository.
For user-facing docs, see `README.md`, `README.pt-br.md`, `README.es.md`,
`PUBLISHING.md`.

## What this repo is

VS Code extension `codemastersolutions.docker-terminal` (workspace-kind). Bundles
`src/extension.ts` to `dist/extension.js` via esbuild; only `dist/`, `assets/`,
`package.json`, and `LICENSE` ship in the `.vsix` (see `.vscodeignore`).

- `engines.vscode`: `^1.85.0` (Node 20 in CI).
- Publisher ID `codemastersolutions` is immutable — never rename.
- Three marketplaces: VS Code (`vsce`), Open VSX (`ovsx`),
  GitHub Releases. TRAE marketplace is documented in `PUBLISHING.md` but not
  wired in CI yet (no stable CLI).

## Repo layout

```
src/
  extension.ts           # activate()/deactivate(), command registration
  compose/               # YAML parsing, TreeDataProvider, validation regexes
  containers/            # host-wide container list + tree view
  docker/                # DockerClient wrapper, /etc/passwd shell probe
  host/                  # OS-specific `clear`/`cls` selection
  info/                  # status-bar item (extension name/version/repo link)
  terminals/             # VS Code terminal lifecycle
test/                    # *.smoke.ts run via tsx; fixtures/ holds compose sample
scripts/bump-version.js  # Conventional Commits → semver (reads last v* git tag)
```

`src/` is excluded from the `.vsix` — edit there, never in `dist/`.

## Build, test, lint

All commands assume repo root. Precommit (via `commitzero`) and `npm run prebuild`
chain them in this order:

```
clean → typecheck → test → build
```

| Command                         | Notes                                         |
| ------------------------------- | --------------------------------------------- |
| `npm install`                   | One-time                                      |
| `npm run typecheck`             | `tsc --noEmit` — strict, `noUnusedLocals` on |
| `npm run test:unit`             | Pure smoke tests, no Docker required          |
| `npm run test:integration`      | Needs `docker compose` / `docker-compose` CLI |
| `npm run test:e2e`              | Needs a running Docker daemon                 |
| `npm test`                      | unit → integration → e2e                      |
| `npm run build`                 | esbuild → `dist/extension.js` (minified)      |
| `npm run watch`                 | esbuild `--watch`                             |
| `npm run package`               | build + `vsce package` (no git tag)           |
| `npm run release:version`       | Preview the next semver locally               |

### Test quirks

- Tests are smoke-style (`test/*.smoke.ts`) executed by `tsx` — no test
  runner. Each file is a standalone `run().catch(...)` script.
- `test:integration` and `test:e2e` **skip with exit 0** when Docker is
  unavailable. They probe availability before running; CI runs them with a
  started daemon (`release.yml`).
- To run a single test file: `npx tsx test/parser.smoke.ts`.
- Smoke tests read the fixture at `test/fixtures/docker-compose.yml` —
  keep that file portable (no `version:` key — compose-spec v2 top-level
  `name:` only).

## Commit / release flow

- Conventional Commits enforced via `@codemastersolutions/commitzero`
  (config in `commitzero.config.json`).
- `npm run commit` → interactive commit; `npm run commitzero:install` →
  wire git hooks. Hooks run `typecheck`, `test`, `build` before commit.
- Version bump is automatic on PR merge to `main` (`release.yml`), driven
  by `scripts/bump-version.js` reading the latest `vX.Y.Z` git tag.
  Bump rule: `feat:` → minor, `fix:` → patch, `feat!:` or
  `BREAKING CHANGE` footer → major, otherwise patch.
- The release workflow uses concurrency group `release`
  (`cancel-in-progress: false`) — two merges in quick succession will
  queue, not race.
- Required secrets: `VSCE_PAT` (Azure DevOps, Marketplace → Manage),
  `OVSX_PAT` (open-vsx.org), `GITHUB_TOKEN` (auto). Publish steps
  `if: env.<SECRET> != ''` so a missing token skips that marketplace
  cleanly.
- After release, the workflow force-tags `vX.Y.Z` and force-pushes it.

## Security-relevant code paths

When touching anything that ends up in argv or a shell command, preserve the
existing whitelists in `src/compose/validation.ts`:

- Service name: `^[a-z0-9][a-z0-9_-]*$` (compose-spec).
- Shell path: `^\/[a-zA-Z0-9/._+-]+$` plus no `..` segments.
- Container id: `^[a-f0-9]{1,64}$`.
- Container name: `^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$`.

`docker compose` argv order is fixed in `DockerClient.buildArgv`:
`[prefix] -p <project> -f <file> <subcommand...>`. The integration test
asserts that order — keep `-p` and `-f` ahead of the subcommand.

Default-shell detection (`src/docker/shell.ts`) tries three probes in order:
`getent passwd` → `grep /etc/passwd` → `echo $SHELL`. Each probe result is
validated against `isValidShellPath` and then `test -x` inside the container
before being trusted. Do not skip the verification step.

## Dependabot

`.github/dependabot.yml` groups npm minor+patch into one PR (max 5 open),
keeps majors separate, and tags GitHub Actions updates with `ci` prefix.
Comment in the file asks maintainers to pin Actions refs to commit SHAs
(`@<sha>  # vX.Y.Z`) — supply-chain hardening on top of the version tags
used in workflows. Apply that pinning when bumping Actions versions.

## Things agents commonly get wrong here

- Editing `dist/` directly. The esbuild bundle is regenerated on every
  `npm run build` and is `.vscodeignore`-excluded from the package anyway.
- Forgetting that `npm run prebuild` runs before `build` (it runs
  `clean` first, which removes `dist/` and any `docker-terminal-*.vsix`).
- Treating `package.json` version as the source of truth — for releases
  it's overwritten by `scripts/bump-version.js`.
- Adding new test files outside the `*.smoke.ts` convention or skipping
  the docker-availability probe in `test:integration` / `test:e2e`. CI
  expects those tests to run, dev environments expect them to skip
  cleanly when Docker is absent.
- Renaming the publisher or the extension id — both are immutable once
  published to a marketplace.
- Publishing without bumping the README/CHANGELOG; `PUBLISHING.md`
  lists the pre-publish checklist.
