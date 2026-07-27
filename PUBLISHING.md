# Publishing Guide

How to ship `@codemastersolutions/docker-terminal` to the major VS Code-compatible marketplaces.

> **Package:** `@codemastersolutions/docker-terminal` v`0.1.0`
> **CLI used:** `vsce` (Visual Studio Code Extensions)
> **Output:** `dist/extension.js` bundled by `esbuild` → `*.vsix` archive

> 🌐 **Idiomas / Languages:** [English](README.md) · [Português (Brasil)](README.pt-br.md) · [Español](README.es.md)

---

## Table of contents

1. [Pre-publish checklist](#pre-publish-checklist)
2. [Versioning](#versioning)
3. [Build the `.vsix`](#build-the-vsix)
4. [VS Code Marketplace (official)](#vs-code-marketplace-official)
5. [Open VSX Registry (for VS Code forks)](#open-vsx-registry-for-vs-code-forks)
6. [TRAE Marketplace](#trae-marketplace)
7. [GitHub Releases (manual distribution)](#github-releases-manual-distribution)
8. [CI/CD with GitHub Actions](#cicd-with-github-actions)
9. [Troubleshooting](#troubleshooting)

---

## Pre-publish checklist

Before every release, confirm:

- [ ] `package.json` → `version` bumped
- [ ] `package.json` → `publisher` is `codemastersolutions`
- [ ] `package.json` → `engines.vscode` matches the minimum supported
- [ ] `README.md`, `README.pt-br.md`, `README.es.md` are up to date
- [ ] `LICENSE` (MIT) is present at the root
- [ ] `.vscodeignore` excludes `node_modules`, `*.vsix`, `.DS_Store`, `.vscode-test*`
- [ ] Repo is committed and the working tree is clean
- [ ] `npm run typecheck` passes (no `tsc` errors)
- [ ] Smoke tests pass against a live docker daemon (`test/*.smoke.ts`)
- [ ] A `CHANGELOG.md` entry exists for the new version

`.vscodeignore` (the file used by both `vsce` and `ovsx`) should look like:

```gitignore
node_modules
*.vsix
.DS_Store
.vscode-test
.vscode-test-web
```

## Versioning

Use [Semantic Versioning](https://semver.org/):

- **MAJOR** — breaking changes (e.g. settings renamed, commands removed)
- **MINOR** — backwards-compatible features (e.g. new setting, new command)
- **PATCH** — backwards-compatible bug fixes

Two ways to bump:

```bash
# Manual edit of package.json
# (or)
npm version patch   # 0.1.0 → 0.1.1
npm version minor   # 0.1.0 → 0.2.0
npm version major   # 0.1.0 → 1.0.0
```

`npm version` also creates a git tag automatically — keep that, the marketplaces and CI use it.

## Build the `.vsix`

```bash
npm install
npm run build          # node esbuild.config.js → dist/extension.js
npx vsce package       # produces ./docker-terminal-<version>.vsix
```

The result will be a single file like `docker-terminal-0.1.0.vsix` (~88 KB, as committed in this repo).

Useful flags:

```bash
npx vsce package --no-dependencies          # skip npm install
npx vsce package --target linux-x64         # cross-compile for another platform (Node part)
npx vsce package --out ./releases/myext.vsix
```

> `vsce package` validates `package.json`, runs the `vscode:prepublish` script if defined, and walks `.vscodeignore` to decide what gets archived.

---

## VS Code Marketplace (official)

The official marketplace at <https://marketplace.visualstudio.com/> is the primary distribution channel. Every install from inside VS Code's Extensions view comes from here.

### 1. One-time setup

1. Create a **Microsoft / Azure DevOps** account tied to the publisher:
   <https://marketplace.visualstudio.com/manage>
2. Create a **publisher** with id `codemastersolutions` (must match `package.json`).
3. Generate a **Personal Access Token (PAT)**:
   <https://dev.azure.com/_usersSettings/tokens>
   - Scopes required: **Marketplace → Manage**
4. Store the PAT safely (do **not** commit it):

   ```bash
   export VSCE_PAT=<your-token>
   # or
   npx vsce login codemastersolutions
   # it will prompt for the PAT and cache it in ~/.vsce
   ```

### 1.1 Publisher display name (optional)

The publisher `id` (`codemastersolutions`) is **immutable** once created — the extension ID `codemastersolutions.docker-terminal` depends on it, so it must never change.

The **display name** shown under the extension title in the Extensions panel is a separate field managed in the Marketplace publisher profile, **not** in `package.json`. That's how Microsoft publishes `ms-azuretools.vscode-docker` under the display name **Microsoft** while keeping a short slug as ID.

To set the display name to **`CodeMaster Soluções`**:

1. Open <https://marketplace.visualstudio.com/manage/publishers/codemastersolutions>
2. **Edit profile** → set **Display Name** to `CodeMaster Soluções`
3. Save

The change propagates within minutes. The extension listing will then read:

> **Docker Terminal**
> Open a terminal into a docker-compose...
> **CodeMaster Soluções**

…while the install command and ID remain unchanged:

```bash
code --install-extension codemastersolutions.docker-terminal
```

> ⚠️ Display name only applies once the publisher has been created in the Marketplace. On the very first publish, the Marketplace shows the ID (`codemastersolutions`) as the name until you edit the profile.

### 2. Publish

```bash
# auto-bump version + publish + git tag
npx vsce publish

# or, with explicit version
npx vsce publish patch
npx vsce publish minor
npx vsce publish 0.1.1

# publish a pre-built .vsix without bumping version
npx vsce publish --packagePath ./docker-terminal-0.1.0.vsix
```

### 3. Verify

- <https://marketplace.visualstudio.com/items?itemName=codemastersolutions.docker-terminal>
- Inside VS Code: `code --install-extension codemastersolutions.docker-terminal`

---

## Open VSX Registry (for VS Code forks)

VS Code forks (Cursor, Windsurf, VSCodium, Gitpod, code-server, Eclipse Theia, GitHub Codespaces, etc.) don't use the Microsoft marketplace. They use the open-source **Open VSX Registry** at <https://open-vsx.org/>.

Publishing to Open VSX maximizes reach across those editors.

### 1. One-time setup

1. Create an account at <https://open-vsx.org/login>
2. Create (or claim) a namespace matching `codemastersolutions`
3. Generate an access token: <https://open-vsx.org/user-settings/tokens>
4. Install the CLI:

   ```bash
   npm i -g ovsx
   ```

> 💡 Open VSX namespaces also have a **display name** editable at <https://open-vsx.org/user-settings/namespaces>. Set it to `CodeMaster Soluções` to keep the listing consistent across VS Code Marketplace, Open VSX, and TRAE.

### 2. Publish

```bash
export OVSX_PAT=<open-vsx-token>
npx ovsx publish docker-terminal-0.1.0.vsix -p codemastersolutions
```

Or, for a freshly built version:

```bash
npx vsce package
npx ovsx publish
```

### 3. Verify

- <https://open-vsx.org/extension/codemastersolutions/docker-terminal>

---

## TRAE Marketplace

**TRAE** (by ByteDance) is an AI-native VS Code-compatible IDE. Its marketplace is at <https://marketplace.trae.ai/> and accepts standard `.vsix` packages built for VS Code.

> ⚠️ TRAE's publisher portal is newer and its docs change more often than the VS Code marketplace. Always re-check <https://marketplace.trae.ai/docs> for the latest flow before each release.

### 1. One-time setup

1. Create a **TRAE ID** account at <https://trae.ai/> or via the TRAE desktop app.
2. Open the publisher portal: <https://marketplace.trae.ai/developer> (or whichever path the current docs link to).
3. Register a publisher with the id `codemastersolutions`.
4. The same `.vsix` produced by `vsce package` is accepted — no rebuild needed.

### 2. Publish

TRAE's portal flow (as documented at the time of writing):

1. Sign in to the TRAE Marketplace publisher console.
2. Click **Upload Extension** → choose `docker-terminal-<version>.vsix`.
3. Fill in the listing metadata (name, description, categories, icon, screenshots).
4. Submit for review (TRAE performs a security/review pass before public listing).
5. Once approved, the extension becomes searchable inside the TRAE IDE.

If a CLI path becomes available, it will mirror the VS Code flow:

```bash
# pseudo-CLI (verify against current TRAE docs)
trae-cli login
trae-cli publish ./docker-terminal-0.1.0.vsix
```

Until that CLI is stable, the web upload is the canonical method.

### 3. Verify

- <https://marketplace.trae.ai/extension/codemastersolutions/docker-terminal>
- Inside TRAE: Extensions panel → search "Docker Terminal" → Install

---

## GitHub Releases (manual distribution)

Useful for users on locked-down environments, air-gapped machines, or to deliver a hotfix without waiting for marketplace review.

### 1. Create a GitHub release

1. Tag the commit:

   ```bash
   git tag v0.1.0
   git push origin v0.1.0
   ```

2. Build:

   ```bash
   npm run build && npx vsce package
   ```

3. On GitHub: **Releases → Draft a new release → choose tag `v0.1.0`**.
4. Attach `docker-terminal-0.1.0.vsix` as a binary asset.
5. Publish.

### 2. Install from release

```bash
code --install-extension https://github.com/codemastersolutions/code-docker-terminal/releases/download/v0.1.0/docker-terminal-0.1.0.vsix
```

Or download and double-click the `.vsix` in VS Code / TRAE.

---

## CI/CD with GitHub Actions

This repo ships with two workflows that run automatically:

### `.github/workflows/ci.yml` — PR checks

Triggered on every PR opened/synchronised against `main` (and on pushes to feature branches):

- typecheck (`tsc --noEmit`)
- unit tests (`npm run test:unit` — no Docker needed)
- build (`npm run build`)
- a smoke `vsce package` to make sure the bundle still produces a valid `.vsix`

### `.github/workflows/release.yml` — release on merge

Triggered **only** when a PR is **merged** into `main`. Pipeline:

1. Checkout with full history (`fetch-depth: 0`) so we can read tags
2. `npm ci` + typecheck
3. Start Docker daemon on the runner
4. Run **all** test stages: `test:unit` → `test:integration` → `test:e2e`
5. Bump the version with `scripts/bump-version.js` (Conventional Commits → semver; tag-based base, default = patch)
6. Build (`npm run build`) + `vsce package` → `.vsix`
7. Publish to **VS Code Marketplace** (`vsce publish`)
8. Publish to **Open VSX** (`ovsx publish`)
9. Commit the version bump back to `main` with `[skip ci]`
10. Create/push the git tag `vX.Y.Z`
11. Create the **GitHub Release** with the `.vsix` attached

TRAE publishing is intentionally **not** wired in yet — TRAE's marketplace does not expose a stable CLI today. When ByteDance ships one, add a `Publish to TRAE Marketplace` step next to the VS Code/Open VSX steps using a `TRAE_PAT` secret.

### Required GitHub repository secrets

Configure under **Settings → Secrets and variables → Actions**:

| Secret | Purpose |
|---|---|
| `VSCE_PAT` | VS Code Marketplace — Azure DevOps PAT with **Marketplace → Manage** scope |
| `OVSX_PAT` | Open VSX — token from <https://open-vsx.org/user-settings/tokens> |
| `TRAE_PAT` | (future) TRAE marketplace token |
| `GITHUB_TOKEN` | Automatic — used to push the version-bump commit and tag |

> The publish steps use `if: env.<SECRET> != ''` so the workflow skips a marketplace cleanly if its secret isn't configured yet, instead of failing the entire release.

### Local version bump (manual)

If you want to preview the next version locally without pushing a commit:

```bash
npm run release:version
# bump-version: 0.1.0 → 0.2.0 (minor) — 4 commit(s) since v0.1.0
```

Then reset before committing if you don't want the bump in the working tree.

---

## Troubleshooting

### `vsce` says "Missing publisher name"

`package.json` is missing `"publisher": "codemastersolutions"`. Add it and retry.

### `vsce` says "Make sure to edit the README.md before publishing"

It enforces a non-empty README at the root. All three READMEs are present in this repo, so this should not fire.

### `vsce` says "LICENSE, LICENSE.md or LICENSE.txt not found"

Place the MIT `LICENSE` file at the repo root (already present here).

### Open VSX: "Forbidden: missing scope `namespace:create`"

Your token doesn't have the right scope. Regenerate it at <https://open-vsx.org/user-settings/tokens> with `namespace:create` and `extension:create`.

### TRAE: extension rejected at review

- Make sure the `repository.url` in `package.json` is reachable and matches the publisher.
- Verify the `.vsix` was built with the same `publisher` and `name` you registered.
- Re-check the current TRAE docs for any new metadata requirements (icon dimensions, screenshots, etc.).

### Version already exists on a marketplace

Marketplaces are immutable per version. Bump the version, rebuild, and re-publish. You cannot overwrite a published version.

---

## Summary matrix

| Marketplace | URL | Auth | CLI | Audience |
|---|---|---|---|---|
| VS Code Marketplace | marketplace.visualstudio.com | Azure PAT | `vsce` | VS Code users |
| Open VSX | open-vsx.org | Open VSX token | `ovsx` | Cursor, Windsurf, VSCodium, Codespaces, Theia |
| TRAE Marketplace | marketplace.trae.ai | TRAE ID + portal | web upload (CLI TBD) | TRAE IDE users |
| GitHub Releases | github.com/.../releases | GitHub token | `gh release create` | Manual / offline installs |