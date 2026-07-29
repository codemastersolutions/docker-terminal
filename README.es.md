<img src="./assets/banner-readme.png">

Una extensión que abre un terminal en un servicio de `docker-compose` usando el **shell de inicio de sesión predeterminado del contenedor** (leído desde `/etc/passwd`), no un `bash`/`sh` fijo en el código.

> 🌐 **Idiomas:** [English](README.md) · [Português (Brasil)](README.pt-br.md) · [Español](README.es.md)

## Características

- Lista los servicios de cualquier `docker-compose.{yml,yaml}` o `compose.{yml,yaml}` en el workspace
- Dos vistas en la barra lateral: **Containers** (todos los contenedores en ejecución en el host, incluso sin docker-compose) y **Compose Services** (servicios de los archivos compose del workspace)
- **Controles inline de ciclo de vida** — botones Start / Stop / Restart / Logs en cada fila, condicionados al estado del contenedor/servicio
- Abre un terminal real conectado vía `docker compose exec` (ruta compose) o `docker exec` (ruta lateral)
- **Logs** abren un terminal dedicado que sigue `docker compose logs -f <service>` o `docker logs -f --details <container>`
- Inicia el contenedor automáticamente si está detenido (o ejecuta `docker compose up -d`, que respeta `depends_on`)
- Detecta el shell de inicio de sesión predeterminado del contenedor por servicio (`/bin/bash`, `/bin/zsh`, `/bin/ash`, etc.)
- Observa `docker-compose.{yml,yaml}` y `compose.{yml,yaml}` por cambios y actualiza la vista Compose automáticamente
- **Info status bar** en el pie de la ventana mostrando el nombre de la extensión, versión instalada y enlace clicable al repositorio en GitHub
- Compatible con Docker Compose v2 (`docker compose`) y hace fallback a v1 (`docker-compose`)
- Compatible con workspaces multi-raíz
- Atajo `Ctrl+Shift+T` / `Cmd+Shift+T` abre el selector de shell del compose

## Requisitos

- VS Code `^1.85.0`
- Docker CLI instalado y disponible en el `PATH`
- Docker Compose v2 (recomendado) o v1

## Uso

### Barra lateral Containers (cualquier workspace, incluso sin docker-compose)

1. Haz clic en el icono **Containers** en la barra lateral
2. El panel lista todos los contenedores en ejecución en el host
3. Haz clic en un contenedor — se abre un terminal con `docker exec -it <id> <shell>`
4. Iconos inline en la fila: `$(terminal)` shell · `$(play)` iniciar · `$(stop)` detener · `$(refresh)` reiniciar · `$(output)` logs
5. Usa el botón **$(refresh)** en el título de la vista para reescanear

### Barra lateral Compose Services (workspace con docker-compose.yml)

1. Haz clic en el icono **Compose Services** en la barra lateral
2. El panel lista todos los servicios de los archivos compose encontrados en el workspace
3. Iconos inline en la fila: `$(terminal)` shell · `$(play)` iniciar · `$(stop)` detener · `$(refresh)` reiniciar · `$(output)` logs
4. **Iniciar** ejecuta `docker compose up -d <service>`, que respeta `depends_on` — las dependencias faltantes/detenidas se inician primero
5. La vista se actualiza sola cuando los archivos compose cambian en disco

### Paleta de Comandos

1. **Docker Terminal: Open Shell in Service** — elige archivo compose → elige servicio → se abre el terminal
2. **Docker Terminal: Open Shell in Container** — abre un shell en un contenedor seleccionado
3. Teclado: `Ctrl+Shift+T` (Linux/Windows) o `Cmd+Shift+T` (macOS) para el selector del compose

## Cómo funciona

1. Al activarse, la extensión carga dos entradas en la barra lateral — **Containers** y **Compose Services** — además de un item de info en la status bar mostrando el nombre de la extensión y la versión, con enlace clicable al repositorio en GitHub.
2. La vista Containers ejecuta `docker ps --no-trunc --format '{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Status}}'` y lista todos los contenedores en ejecución. La actualización tiene debounce y se ejecuta automáticamente cuando el panel se vuelve visible.
3. Al hacer clic en un contenedor se ejecuta `docker exec <container> getent passwd <user | 0>` para leer el shell de inicio de sesión predeterminado del contenedor desde `/etc/passwd`, y luego abre un terminal con `docker exec -it <id> <shell>`.
4. La vista Compose observa `docker-compose.{yml,yaml}` y `compose.{yml,yaml}` vía `FileSystemWatcher` y vuelve a parsear con `js-yaml` ante cambios. Ejecutar `docker compose up -d <service>` respeta `depends_on` — inicia el servicio y cualquier dependencia faltante/detenida, en orden de declaración, antes de conectar.
5. Los iconos inline de `Logs` abren un terminal dedicado precargado con `docker compose logs -f <service>` o `docker logs -f --details <container>` — `Ctrl+C` detiene el tail.

Esto significa que los contenedores basados en Alpine obtienen `ash`, Debian/Ubuntu obtienen `bash`, y las imágenes personalizadas con `zsh`/`fish` configurados como shell predeterminado funcionan sin ajustes — sin un shell fijo en el código.

## Configuración

| Configuración                     | Predeterminado          | Descripción                                                                                                                                                                                                                                                                                           |
| --------------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `composeTerminal.dockerCommand`   | `docker`                | Ruta o nombre del docker CLI                                                                                                                                                                                                                                                                          |
| `composeTerminal.preferComposeV2` | `true`                  | Usar `docker compose` antes de caer al fallback `docker-compose`                                                                                                                                                                                                                                      |
| `composeTerminal.composeFiles`    | `[]`                    | Rutas explícitas de archivos compose (vacío = autodetectar en las raíces del workspace)                                                                                                                                                                                                               |
| `composeTerminal.terminalName`    | `{service} • {project}` | Patrón del nombre del terminal. Placeholders: `{service}`, `{project}`                                                                                                                                                                                                                                |
| `composeTerminal.clearOnExit`     | `true`                  | Enmarca el `docker compose exec` con un comando de limpieza del shell del host (`clear` en Linux/macOS, `cls` en Windows): uno antes de conectar y otro después de salir, para que el terminal de VS Code quede limpio antes de entrar y al salir del contenedor. Define como `false` para desactivar |

## Comandos

| Comando                             | Título                                       |
| ----------------------------------- | -------------------------------------------- |
| `compose.openShell`                 | Docker Terminal: Open Shell in Service       |
| `composeTerminal.refreshContainers` | Docker Terminal: Refresh (Containers)        |
| `composeTerminal.refreshCompose`    | Docker Terminal: Refresh (Compose)           |
| `composeTerminal.attachContainer`   | Docker Terminal: Open Shell in Container     |
| `composeTerminal.composeShell`      | Docker Terminal: Open Shell (Service)        |
| `composeTerminal.composeStart`      | Docker Terminal: Start Service               |
| `composeTerminal.composeStop`       | Docker Terminal: Stop Service                |
| `composeTerminal.composeRestart`    | Docker Terminal: Restart Service             |
| `composeTerminal.composeLogs`       | Docker Terminal: Service Logs                |
| `composeTerminal.containerStart`    | Docker Terminal: Start Container             |
| `composeTerminal.containerStop`     | Docker Terminal: Stop Container              |
| `composeTerminal.containerRestart`  | Docker Terminal: Restart Container           |
| `composeTerminal.containerLogs`     | Docker Terminal: Container Logs              |
| `composeTerminal.openRepo`          | Docker Terminal: Open Repository             |

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
├── extension.ts          # punto de entrada, registro de comandos, vistas de la barra lateral
├── compose/
│   ├── parser.ts         # parsing YAML, descubrimiento en el workspace
│   ├── types.ts          # ComposeFileRef, ComposeProject, ComposeService
│   ├── validation.ts     # regexes de whitelist para service/shell/container
│   └── provider.ts       # TreeDataProvider de la vista Compose Services + file watcher
├── containers/
│   ├── types.ts          # ContainerInfo, ContainerTreeItem
│   └── provider.ts       # TreeDataProvider de la vista Containers
├── docker/
│   ├── client.ts         # wrapper del DockerClient (fallback v2 → v1, ps/listing, exec)
│   └── shell.ts          # detección del shell predeterminado vía /etc/passwd
├── host/
│   └── clearCommand.ts   # selección de `clear`/`cls` por SO
├── info/
│   └── statusBar.ts      # item de info de la extensión en la status bar inferior
└── terminals/
    └── manager.ts        # ciclo de vida de los terminales de VS Code (compose y container)
test/                     # smoke tests (algunos requieren un daemon docker activo)
```

## Licencia

MIT

## Ver también

- [Guía de publicación](PUBLISHING.md) — cómo distribuir esta extensión en los marketplaces de VS Code, Open VSX, TRAE y mediante GitHub Releases.
