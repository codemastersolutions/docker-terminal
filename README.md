# Docker Terminal

A VS Code extension that opens a terminal into a `docker-compose` service using the **container's default login shell** (read from `/etc/passwd`), not a hardcoded `bash`/`sh`.

> 🌐 **Languages / Idiomas / Línguas:** [English](README.md) · [Português (Brasil)](README.pt-br.md) · [Español](README.es.md)

## Features

- Lists services from any `docker-compose.{yml,yaml}` or `compose.{yml,yaml}` in the workspace
- Opens a real terminal attached via `docker compose exec`
- Auto-starts the container if it's stopped
- Detects the container's default login shell per service (`/bin/bash`, `/bin/zsh`, `/bin/ash`, etc.)
- Works with Docker Compose v2 (`docker compose`) and falls back to v1 (`docker-compose`)
- Multi-root workspace aware

## Requirements

- VS Code `^1.85.0`
- Docker CLI installed and on `PATH`
- Docker Compose v2 (recommended) or v1

## Usage

1. Open a workspace that contains a `docker-compose.yml`
2. Run **Docker Terminal: Open Shell in Service** from the Command Palette
3. Pick a compose file (skipped if only one exists)
4. Pick a service
5. A terminal opens with the container's default shell

## How it works

1. The extension scans the workspace roots for `docker-compose.{yml,yaml}` and `compose.{yml,yaml}` files (or uses the explicit list from the `composeTerminal.composeFiles` setting).
2. It parses each compose file with `js-yaml` and lists the `services` entries.
3. When you pick a service, the extension calls `docker compose up -d <service>` (or `docker-compose` for v1) if the container is stopped.
4. It runs `docker exec <container> getent passwd <user | 0>` to read the container's default login shell from `/etc/passwd`.
5. A VS Code terminal is opened and `docker compose exec -it <service> <shell>` is executed inside it.

This means Alpine-based containers get `ash`, Debian/Ubuntu get `bash`, and custom images with `zsh`/`fish` configured as the default shell just work — no hardcoded shell.

## Settings

| Setting | Default | Description |
|---|---|---|
| `composeTerminal.dockerCommand` | `docker` | Path or name of the docker CLI |
| `composeTerminal.preferComposeV2` | `true` | Use `docker compose` before falling back to `docker-compose` |
| `composeTerminal.composeFiles` | `[]` | Explicit compose file paths (empty = auto-detect in workspace roots) |
| `composeTerminal.terminalName` | `{service} • {project}` | Terminal name pattern. Placeholders: `{service}`, `{project}` |
| `composeTerminal.clearTerminalAfterMs` | `1500` | ms to wait before sending clear-screen ANSI to hide host shell noise. Set to `0` to disable |

## Commands

| Command | Title |
|---|---|
| `compose.openShell` | Docker Terminal: Open Shell in Service |

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
├── extension.ts          # entry point, command registration
├── compose/
│   ├── parser.ts         # YAML parsing, workspace discovery
│   └── types.ts          # ComposeFileRef, ComposeProject, ComposeService
├── docker/
│   ├── client.ts         # DockerClient wrapper (v2 → v1 fallback)
│   └── shell.ts          # /etc/passwd default-shell detection
└── terminals/
    └── manager.ts        # VS Code terminal lifecycle
test/                     # smoke tests (require a live docker daemon)
```

## License

MIT

## See also

- [Publishing Guide](PUBLISHING.md) — how to ship this extension to the VS Code, Open VSX, TRAE marketplaces and GitHub Releases.