<img src="./assets/banner-readme.png">

Una extensión que abre un terminal en un servicio de `docker-compose` usando el **shell de inicio de sesión predeterminado del contenedor** (leído desde `/etc/passwd`), no un `bash`/`sh` fijo en el código.

> 🌐 **Idiomas:** [English](README.md) · [Português (Brasil)](README.pt-br.md) · [Español](README.es.md)

## Características

- Lista los servicios de cualquier `docker-compose.{yml,yaml}` o `compose.{yml,yaml}` en el workspace
- Abre un terminal real conectado vía `docker compose exec`
- Inicia el contenedor automáticamente si está detenido
- Detecta el shell de inicio de sesión predeterminado del contenedor por servicio (`/bin/bash`, `/bin/zsh`, `/bin/ash`, etc.)
- Compatible con Docker Compose v2 (`docker compose`) y hace fallback a v1 (`docker-compose`)
- Compatible con workspaces multi-raíz

## Requisitos

- VS Code `^1.85.0`
- Docker CLI instalado y disponible en el `PATH`
- Docker Compose v2 (recomendado) o v1

## Uso

1. Abre un workspace que contenga un `docker-compose.yml`
2. Ejecuta **Docker Terminal: Open Shell in Service** desde la Paleta de Comandos
3. Elige un archivo compose (se omite si solo hay uno)
4. Elige un servicio
5. Se abre un terminal con el shell predeterminado del contenedor

## Cómo funciona

1. La extensión escanea las raíces del workspace en busca de archivos `docker-compose.{yml,yaml}` y `compose.{yml,yaml}` (o usa la lista explícita definida en `composeTerminal.composeFiles`).
2. Parsea cada archivo compose con `js-yaml` y lista las entradas de `services`.
3. Cuando eliges un servicio, la extensión ejecuta `docker compose up -d <service>` (o `docker-compose`, en v1) si el contenedor está detenido.
4. Ejecuta `docker exec <container> getent passwd <user | 0>` para leer el shell de inicio de sesión predeterminado del contenedor desde `/etc/passwd`.
5. Se abre un terminal de VS Code y se ejecuta `docker compose exec -it <service> <shell>` dentro de él.

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

| Comando             | Título                                 |
| ------------------- | -------------------------------------- |
| `compose.openShell` | Docker Terminal: Open Shell in Service |

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
├── extension.ts          # punto de entrada, registro de comandos
├── compose/
│   ├── parser.ts         # parsing YAML, descubrimiento en el workspace
│   └── types.ts          # ComposeFileRef, ComposeProject, ComposeService
├── docker/
│   ├── client.ts         # wrapper de DockerClient (fallback v2 → v1)
│   └── shell.ts          # detección del shell predeterminado vía /etc/passwd
└── terminals/
    └── manager.ts        # ciclo de vida de los terminales de VS Code
test/                     # smoke tests (requieren un daemon docker activo)
```

## Licencia

MIT

## Ver también

- [Guía de publicación](PUBLISHING.md) — cómo distribuir esta extensión en los marketplaces de VS Code, Open VSX, TRAE y mediante GitHub Releases.
