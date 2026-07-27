<img src="./assets/banner-readme.png">

Uma extensão que abre um terminal em um serviço do `docker-compose` usando o **shell padrão de login do container** (lido de `/etc/passwd`), e não um `bash`/`sh` fixo no código.

> 🌐 **Idiomas:** [English](README.md) · [Português (Brasil)](README.pt-br.md) · [Español](README.es.md)

## Funcionalidades

- Lista os serviços de qualquer `docker-compose.{yml,yaml}` ou `compose.{yml,yaml}` no workspace
- **Painel "Containers" na barra lateral: lista todos os containers em execução no host (`docker ps`), mesmo sem docker-compose no workspace — clique para abrir um shell**
- Abre um terminal real anexado via `docker compose exec` (caminho compose) ou `docker exec` (caminho lateral)
- Inicia o container automaticamente se ele estiver parado
- Detecta o shell padrão de login do container por serviço (`/bin/bash`, `/bin/zsh`, `/bin/ash`, etc.)
- Compatível com Docker Compose v2 (`docker compose`) e faz fallback para v1 (`docker-compose`)
- Suporta workspaces com múltiplas raízes

## Requisitos

- VS Code `^1.85.0`
- Docker CLI instalado e disponível no `PATH`
- Docker Compose v2 (recomendado) ou v1

## Uso

### Barra lateral (qualquer workspace, mesmo sem docker-compose)

1. Clique no ícone **Containers** na barra lateral
2. O painel "Containers em Execução" lista todos os containers rodando no host
3. Clique em um container — um terminal abre com `docker exec -it <id> <shell>`
4. Use o botão **$(refresh)** no título da view para reescanear

### Compose (workspace com docker-compose.yml)

1. Abra um workspace que contenha um `docker-compose.yml`
2. Execute **Docker Terminal: Open Shell in Service** na Paleta de Comandos
3. Escolha um arquivo compose (essa etapa é pulada se houver apenas um)
4. Escolha um serviço
5. Um terminal é aberto com o shell padrão do container

## Como funciona

1. Ao ativar, a extensão carrega uma entrada "Containers" na barra lateral.
2. A view lateral executa `docker ps --no-trunc --format '{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Status}}'` e lista todos os containers em execução. A atualização é debounceada e roda automaticamente quando o painel se torna visível.
3. Clicar em um container executa `docker exec <container> getent passwd <user | 0>` para ler o shell padrão de login do container em `/etc/passwd`, então abre um terminal com `docker exec -it <id> <shell>`.
4. O comando via compose **Docker Terminal: Open Shell in Service** segue o mesmo passo de detecção de shell. Ele varre o workspace por `docker-compose.{yml,yaml}` / `compose.{yml,yaml}`, faz parse com `js-yaml` e executa `docker compose up -d <service>` (ou fallback v1) para garantir que o container está rodando.

Isso significa que containers baseados em Alpine recebem `ash`, Debian/Ubuntu recebem `bash`, e imagens customizadas com `zsh`/`fish` configurados como shell padrão funcionam sem ajustes — sem shell fixo no código.

## Configurações

| Configuração                           | Padrão                  | Descrição                                                                                                                                                                                |
| -------------------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `composeTerminal.dockerCommand`        | `docker`                | Caminho ou nome do docker CLI                                                                                                                                                            |
| `composeTerminal.preferComposeV2`      | `true`                  | Usar `docker compose` antes de cair no fallback `docker-compose`                                                                                                                         |
| `composeTerminal.composeFiles`         | `[]`                    | Caminhos explícitos de arquivos compose (vazio = autodetectar nas raízes do workspace)                                                                                                   |
| `composeTerminal.terminalName`         | `{service} • {project}` | Padrão de nome do terminal. Placeholders: `{service}`, `{project}`                                                                                                                       |
| `composeTerminal.clearOnExit`          | `true`                  | Enquadra o `docker compose exec` com um comando de limpeza do shell do host (`clear` em Linux/macOS, `cls` no Windows) — um antes de anexar e outro após sair — para que o terminal do VS Code seja limpo antes de entrar e depois de sair do container. Defina como `false` para desativar |

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

Outros scripts:

```bash
npm run watch      # build incremental com esbuild
npm run typecheck  # tsc --noEmit
```

## Estrutura do projeto

```
src/
├── extension.ts          # ponto de entrada, registro de comandos, view lateral
├── compose/
│   ├── parser.ts         # parsing YAML, descoberta no workspace
│   ├── types.ts          # ComposeFileRef, ComposeProject, ComposeService
│   └── validation.ts     # regexes de whitelist para service/shell/container
├── containers/
│   ├── types.ts          # ContainerInfo, ContainerTreeItem
│   └── provider.ts       # TreeDataProvider da view lateral
├── docker/
│   ├── client.ts         # wrapper do DockerClient (fallback v2 → v1, ps/listing, exec)
│   └── shell.ts          # detecção do shell padrão via /etc/passwd
├── host/
│   └── clearCommand.ts   # seleção de `clear`/`cls` por SO
└── terminals/
    └── manager.ts        # ciclo de vida dos terminais do VS Code (compose e container)
test/                     # smoke tests (alguns exigem um daemon docker ativo)
```

## Licença

MIT

## Veja também

- [Guia de publicação](PUBLISHING.md) — como distribuir esta extensão nas lojas VS Code, Open VSX, TRAE e via GitHub Releases.
