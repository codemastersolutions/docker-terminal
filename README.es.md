<img src="./assets/banner-readme.png">

Una extensión que abre un terminal en un servicio de `docker-compose` usando el **shell de inicio de sesión predeterminado del contenedor** (leído desde `/etc/passwd`), no un `bash`/`sh` fijo en el código.

> 🌐 **Idiomas:** [English](README.md) · [Português (Brasil)](README.pt-br.md) · [Español](README.es.md)

## Características

- Lista los servicios de cualquier `docker-compose.{yml,yaml}` o `compose.{yml,yaml}` en el workspace
- **Panel "Containers" en la barra lateral: lista todos los contenedores en ejecución en el host (`docker ps`), incluso sin docker-compose en el workspace — haz clic para abrir un shell**
- Abre un terminal real conectado vía `docker compose exec` (ruta compose) o `docker exec` (ruta lateral)
- Inicia el contenedor automáticamente si está detenido
- Detecta el shell de inicio de sesión predeterminado del contenedor por servicio (`/bin/bash`, `/bin/zsh`, `/bin/ash`, etc.)
- Compatible con Docker Compose v2 (`docker compose`) y hace fallback a v1 (`docker-compose`)
- Compatible con workspaces multi-raíz

## Requisitos

- VS Code `^1.85.0`
- Docker CLI instalado y disponible en el `PATH`
- Docker Compose v2 (recomendado) o v1

## Uso

### Barra lateral (cualquier workspace, incluso sin docker-compose)

1. Haz clic en el icono **Containers** en la barra lateral
2. El panel "Contenedores en Ejecución" lista todos los contenedores corriendo en el host
3. Haz clic en un contenedor — se abre un terminal con `docker exec -it <id> <shell>`
4. Usa el botón **$(refresh)** en el título de la vista para reescanear

### Compose (workspace con docker-compose.yml)

1. Abre un workspace que contenga un `docker-compose.yml`
2. Ejecuta **Docker Terminal: Open Shell in Service** desde la Paleta de Comandos
3. Elige un archivo compose (se omite si solo hay uno)
4. Elige un servicio
5. Se abre un terminal con el shell predeterminado del contenedor

## Cómo funciona

1. Al activarse, la extensión carga una entrada "Containers" en la barra lateral.
2. La vista lateral ejecuta `docker ps --no-trunc --format '{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Status}}'` y lista todos los contenedores en ejecución. La actualización tiene debounce y se ejecuta automáticamente cuando el panel se vuelve visible.
3. Al hacer clic en un contenedor se ejecuta `docker exec <container> getent passwd <user | 0>` para leer el shell de inicio de sesión predeterminado del contenedor desde `/etc/passwd`, y luego abre un terminal con `docker exec -it <id> <shell>`.
4. El comando vía compose **Docker Terminal: Open Shell in Service** sigue el mismo paso de detección de shell. Escanea el workspace por `docker-compose.{yml,yaml}` / `compose.{yml,yaml}`, hace parse con `js-yaml` y ejecuta `docker compose up -d <service>` (o fallback v1) para asegurar que el contenedor está corriendo.

Esto significa que los contenedores basados en Alpine obtienen `ash`, Debian/Ubuntu obtienen `bash`, y las imágenes personalizadas con `zsh`/`fish` configurados como shell predeterminado funcionan sin ajustes — sin un shell fijo en el código.

## Configuración

| Configuración                          | Predeterminado          | Descripción                                                                                                                                                                                                          |
| -------------------------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `composeTerminal.dockerCommand`        | `docker`                | Ruta o nombre del docker CLI                                                                                                                                                                                         |
| `composeTerminal.preferComposeV2`      | `true`                  | Usar `docker compose` antes de caer al fallback `docker-compose`                                                                                                                                                     |
| `composeTerminal.composeFiles`         | `[]`                    | Rutas explícitas de archivos compose (vacío = autodetectar en las raíces del workspace)                                                                                                                              |
| `composeTerminal.terminalName`         | `{service} • {project}` | Patrón del nombre del terminal. Placeholders: `{service}`, `{project}`                                                                                                                                               |
| `composeTerminal.clearOnExit`          | `true`                  | Enmarca el `docker compose exec` con un comando de limpieza del shell del host (`clear` en Linux/macOS, `cls` en Windows): uno antes de conectar y otro después de salir, para que el terminal de VS Code quede limpio antes de entrar y al salir del contenedor. Define como `false` para desactivar |

## Comandos

| Comando                                | Título                                 |
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

Otros scripts:

```bash
npm run watch      # build incremental con esbuild
npm run typecheck  # tsc --noEmit
```

## Estructura del proyecto

```
src/
├── extension.ts          # punto de entrada, registro de comandos, vista lateral
├── compose/
│   ├── parser.ts         # parsing YAML, descubrimiento en el workspace
│   ├── types.ts          # ComposeFileRef, ComposeProject, ComposeService
│   └── validation.ts     # regexes de whitelist para service/shell/container
├── containers/
│   ├── types.ts          # ContainerInfo, ContainerTreeItem
│   └── provider.ts       # TreeDataProvider de la vista lateral
├── docker/
│   ├── client.ts         # wrapper del DockerClient (fallback v2 → v1, ps/listing, exec)
│   └── shell.ts          # detección del shell predeterminado vía /etc/passwd
├── host/
│   └── clearCommand.ts   # selección de `clear`/`cls` por SO
└── terminals/
    └── manager.ts        # ciclo de vida de los terminales de VS Code (compose y container)
test/                     # smoke tests (algunos requieren un daemon docker activo)
```

## Licencia

MIT

## Ver también

- [Guía de publicación](PUBLISHING.md) — cómo distribuir esta extensión en los marketplaces de VS Code, Open VSX, TRAE y mediante GitHub Releases.
