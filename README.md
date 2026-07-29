<img src="./assets/banner-readme.png">

A extension that opens a terminal into a `docker-compose` service using the **container's default login shell** (read from `/etc/passwd`), not a hardcoded `bash`/`sh`.

> 🌐 **Languages / Idiomas / Línguas:** [English](README.md) · [Português (Brasil)](README.pt-br.md) · [Español](README.es.md)

## Features

- Lists services from any `docker-compose.{yml,yaml}` or `compose.{yml,yaml}` in the workspace
- Two sidebar views: **Containers** (every running container on the host, regardless of docker-compose) and **Compose Services** (services from compose files in the workspace)
- **Inline lifecycle controls** — Start / Stop / Restart / Logs buttons appear on each row, gated by container/service state
- Opens a real terminal attached via `docker compose exec` (compose path) or `docker exec` (sidebar path)
- **Logs** open a dedicated terminal that tails `docker compose logs -f <service>` or `docker logs -f --details <container>`
- Auto-starts the container if it's stopped (or runs `docker compose up -d` which honours `depends_on`)
- Detects the container's default login shell per service (`/bin/bash`, `/bin/zsh`, `/bin/ash`, etc.)
- Watches `docker-compose.{yml,yaml}` and `compose.{yml,yaml}` for changes and auto-refreshes the Compose view
- **Info status bar** at the bottom of the window showing the extension name, installed version, and a clickable link to the GitHub repo
- Works with Docker Compose v2 (`docker compose`) and falls back to v1 (`docker-compose`)
- Multi-root workspace aware
- Keybinding `Ctrl+Shift+T` / `Cmd+Shift+T` opens the compose shell picker

## Requirements

- VS Code `^1.85.0`
- Docker CLI installed and on `PATH`
- Docker Compose v2 (recommended) or v1

## Usage

### Containers sidebar (any workspace, even without docker-compose)

1. Click the **Containers** icon in the activity bar
2. The panel lists every running container on the host
3. Click a container — a terminal opens with `docker exec -it <id> <shell>`
4. Inline row icons: `$(terminal)` shell · `$(play)` start · `$(stop)` stop · `$(refresh)` restart · `$(output)` logs
5. Use the **$(refresh)** button on the view title to re-scan

### Compose Services sidebar (workspace with docker-compose.yml)

1. Click the **Compose Services** icon in the activity bar
2. The panel lists every service from compose files found in the workspace
3. Inline row icons: `$(terminal)` shell · `$(play)` start · `$(stop)` stop · `$(refresh)` restart · `$(output)` logs
4. **Start** runs `docker compose up -d <service>` which honours `depends_on` — missing/stopped dependencies are started first
5. The view auto-refreshes when compose files change on disk

### Command Palette

1. **Docker Terminal: Open Shell in Service** — pick compose file → pick service → terminal opens
2. **Docker Terminal: Open Shell in Container** — opens a shell on a selected container
3. Keyboard: `Ctrl+Shift+T` (Linux/Windows) or `Cmd+Shift+T` (macOS) shortcut for the compose picker

## How it works

1. On activation the extension loads two activity-bar entries — **Containers** and **Compose Services** — plus an info status bar item showing the extension name and version with a clickable link to the GitHub repository.
2. The Containers view runs `docker ps --no-trunc --format '{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Status}}'` and lists every running container. Refresh is debounced and auto-runs whenever the panel becomes visible.
3. Clicking a container runs `docker exec <container> getent passwd <user | 0>` to read its default login shell from `/etc/passwd`, then opens a terminal with `docker exec -it <id> <shell>`.
4. The Compose view watches `docker-compose.{yml,yaml}` and `compose.{yml,yaml}` via `FileSystemWatcher` and re-parses them with `js-yaml` on change. Running `docker compose up -d <service>` honours `depends_on` — it starts the service and any missing/stopped dependency in declaration order before attaching.
5. Inline `Logs` icons open a dedicated terminal preloaded with `docker compose logs -f <service>` or `docker logs -f --details <container>` — `Ctrl+C` stops tailing.

This means Alpine-based containers get `ash`, Debian/Ubuntu get `bash`, and custom images with `zsh`/`fish` configured as the default shell just work — no hardcoded shell.

## Settings

| Setting                           | Default                 | Description                                                                                                                                                                                                                                                          |
| --------------------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `composeTerminal.dockerCommand`   | `docker`                | Path or name of the docker CLI                                                                                                                                                                                                                                       |
| `composeTerminal.preferComposeV2` | `true`                  | Use `docker compose` before falling back to `docker-compose`                                                                                                                                                                                                         |
| `composeTerminal.composeFiles`    | `[]`                    | Explicit compose file paths (empty = auto-detect in workspace roots)                                                                                                                                                                                                 |
| `composeTerminal.terminalName`    | `{service} • {project}` | Terminal name pattern. Placeholders: `{service}`, `{project}`                                                                                                                                                                                                        |
| `composeTerminal.clearOnExit`     | `true`                  | Bracket `docker compose exec` with a host-shell cleanup command (`clear` on Linux/macOS, `cls` on Windows) — one before attach and one after exit — so the VS Code terminal is cleared before you enter and after you leave the container. Set to `false` to disable |

## Commands

| Command                                | Title                                       |
| -------------------------------------- | ------------------------------------------- |
| `compose.openShell`                    | Docker Terminal: Open Shell in Service      |
| `composeTerminal.refreshContainers`    | Docker Terminal: Refresh (Containers)       |
| `composeTerminal.refreshCompose`       | Docker Terminal: Refresh (Compose)          |
| `composeTerminal.attachContainer`      | Docker Terminal: Open Shell in Container    |
| `composeTerminal.composeShell`         | Docker Terminal: Open Shell (Service)       |
| `composeTerminal.composeStart`         | Docker Terminal: Start Service              |
| `composeTerminal.composeStop`          | Docker Terminal: Stop Service               |
| `composeTerminal.composeRestart`       | Docker Terminal: Restart Service            |
| `composeTerminal.composeLogs`          | Docker Terminal: Service Logs               |
| `composeTerminal.containerStart`       | Docker Terminal: Start Container            |
| `composeTerminal.containerStop`        | Docker Terminal: Stop Container             |
| `composeTerminal.containerRestart`     | Docker Terminal: Restart Container          |
| `composeTerminal.containerLogs`        | Docker Terminal: Container Logs             |
| `composeTerminal.openRepo`             | Docker Terminal: Open Repository            |

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
├── extension.ts          # entry point, command registration, tree views
├── compose/
│   ├── parser.ts         # YAML parsing, workspace discovery
│   ├── types.ts          # ComposeFileRef, ComposeProject, ComposeService
│   ├── validation.ts     # service/shell/container whitelist regexes
│   └── provider.ts       # TreeDataProvider for the Compose Services view + file watcher
├── containers/
│   ├── types.ts          # ContainerInfo, ContainerTreeItem
│   └── provider.ts       # TreeDataProvider for the Containers view
├── docker/
│   ├── client.ts         # DockerClient wrapper (v2 → v1 fallback, ps/listing, exec)
│   └── shell.ts          # /etc/passwd default-shell detection
├── host/
│   └── clearCommand.ts   # per-OS `clear`/`cls` selection
├── info/
│   └── statusBar.ts      # extension info item in the bottom status bar
└── terminals/
    └── manager.ts        # VS Code terminal lifecycle (compose + container paths)
test/                     # smoke tests (some require a live docker daemon)
```

## License

MIT

## See also

- [Publishing Guide](PUBLISHING.md) — how to ship this extension to the VS Code, Open VSX, TRAE marketplaces and GitHub Releases.
