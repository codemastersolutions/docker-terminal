<img src="./assets/banner-readme.png">

A extension that opens a terminal into a `docker-compose` service using the **container's default login shell** (read from `/etc/passwd`), not a hardcoded `bash`/`sh`.

> 🌐 **Languages / Idiomas / Línguas:** [English](README.md) · [Português (Brasil)](README.pt-br.md) · [Español](README.es.md)

## Features

- Lists services from any `docker-compose.{yml,yaml}` or `compose.{yml,yaml}` in the workspace
- **Sidebar "Containers" view: lists every running container on the host (`docker ps`), regardless of whether docker-compose is in the workspace — click any container to open a shell**
- Opens a real terminal attached via `docker compose exec` (compose path) or `docker exec` (sidebar path)
- Auto-starts the container if it's stopped
- Detects the container's default login shell per service (`/bin/bash`, `/bin/zsh`, `/bin/ash`, etc.)
- Works with Docker Compose v2 (`docker compose`) and falls back to v1 (`docker-compose`)
- Multi-root workspace aware

## Requirements

- VS Code `^1.85.0`
- Docker CLI installed and on `PATH`
- Docker Compose v2 (recommended) or v1

## Usage

### Sidebar (any workspace, even without docker-compose)

1. Click the **Containers** icon in the activity bar
2. The "Running Containers" panel lists every running container on the host
3. Click a container — a terminal opens with `docker exec -it <id> <shell>` inside
4. Use the **$(refresh)** button in the view title to re-scan

### Compose (workspace with docker-compose.yml)

1. Open a workspace that contains a `docker-compose.yml`
2. Run **Docker Terminal: Open Shell in Service** from the Command Palette
3. Pick a compose file (skipped if only one exists)
4. Pick a service
5. A terminal opens with the container's default shell

## How it works

1. On activation the extension loads a "Containers" activity-bar entry.
2. The sidebar view runs `docker ps --no-trunc --format '{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Status}}'` and lists every running container. Refreshing is debounced and auto-runs whenever the panel becomes visible.
3. Clicking a container runs `docker exec <container> getent passwd <user | 0>` to read its default login shell from `/etc/passwd`, then opens a terminal with `docker exec -it <id> <shell>`.
4. The compose-driven **Docker Terminal: Open Shell in Service** command follows the same shell-detection step. It scans the workspace for `docker-compose.{yml,yaml}` / `compose.{yml,yaml}`, parses them with `js-yaml`, and runs `docker compose up -d <service>` (or v1 fallback) to ensure the container is running.

This means Alpine-based containers get `ash`, Debian/Ubuntu get `bash`, and custom images with `zsh`/`fish` configured as the default shell just work — no hardcoded shell.

## Settings

| Setting                                | Default                 | Description                                                                                 |
| -------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------- |
| `composeTerminal.dockerCommand`        | `docker`                | Path or name of the docker CLI                                                              |
| `composeTerminal.preferComposeV2`      | `true`                  | Use `docker compose` before falling back to `docker-compose`                                |
| `composeTerminal.composeFiles`         | `[]`                    | Explicit compose file paths (empty = auto-detect in workspace roots)                        |
| `composeTerminal.terminalName`         | `{service} • {project}` | Terminal name pattern. Placeholders: `{service}`, `{project}`                               |
| `composeTerminal.clearOnExit`          | `true`                  | Bracket `docker compose exec` with a host-shell cleanup command (`clear` on Linux/macOS, `cls` on Windows) — one before attach and one after exit — so the VS Code terminal is cleared before you enter and after you leave the container. Set to `false` to disable |

## Commands

| Command                                | Title                                  |
| -------------------------------------- | -------------------------------------- |
| `compose.openShell`                    | Docker Terminal: Open Shell in Service |
| `composeTerminal.refreshContainers`    | Docker Terminal: Refresh               |
| `composeTerminal.attachContainer`      | Docker Terminal: Open Shell in Container |

## Build

```bash
npm install
npm run build
npx vsce package
```

Other scripts:

```bash
npm run watch      # incremental build with esbuild
npm run typecheck  # tsc --noEmit
```

## Project layout

```
src/
├── extension.ts          # entry point, command registration, tree view wiring
├── compose/
│   ├── parser.ts         # YAML parsing, workspace discovery
│   ├── types.ts          # ComposeFileRef, ComposeProject, ComposeService
│   └── validation.ts     # service/shell/container whitelist regexes
├── containers/
│   ├── types.ts          # ContainerInfo, ContainerTreeItem
│   └── provider.ts       # TreeDataProvider for the sidebar view
├── docker/
│   ├── client.ts         # DockerClient wrapper (v2 → v1 fallback, ps/listing, exec)
│   └── shell.ts          # /etc/passwd default-shell detection
├── host/
│   └── clearCommand.ts   # per-OS `clear`/`cls` selection
└── terminals/
    └── manager.ts        # VS Code terminal lifecycle (compose + container paths)
test/                     # smoke tests (some require a live docker daemon)
```

## License

MIT

## See also

- [Publishing Guide](PUBLISHING.md) — how to ship this extension to the VS Code, Open VSX, TRAE marketplaces and GitHub Releases.
