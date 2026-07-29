<img src="./assets/banner-readme.png">

Uma extensão que abre um terminal em um serviço do `docker-compose` usando o **shell padrão de login do container** (lido de `/etc/passwd`), e não um `bash`/`sh` fixo no código.

> 🌐 **Idiomas:** [English](README.md) · [Português (Brasil)](README.pt-br.md) · [Español](README.es.md)

## Funcionalidades

- Lista os serviços de qualquer `docker-compose.{yml,yaml}` ou `compose.{yml,yaml}` no workspace
- Duas views na barra lateral: **Containers** (todos os containers em execução no host, mesmo sem docker-compose) e **Compose Services** (serviços dos arquivos compose do workspace)
- **Controles inline de ciclo de vida** — botões Start / Stop / Restart / Logs em cada linha, condicionados ao estado do container/serviço
- Abre um terminal real anexado via `docker compose exec` (caminho compose) ou `docker exec` (caminho lateral)
- **Logs** abrem um terminal dedicado que segue `docker compose logs -f <service>` ou `docker logs -f --details <container>`
- Inicia o container automaticamente se estiver parado (ou executa `docker compose up -d`, que respeita `depends_on`)
- Detecta o shell padrão de login do container por serviço (`/bin/bash`, `/bin/zsh`, `/bin/ash`, etc.)
- Observa `docker-compose.{yml,yaml}` e `compose.{yml,yaml}` por mudanças e atualiza a view Compose automaticamente
- **Info status bar** no rodapé da janela mostrando o nome da extensão, versão instalada e link clicável para o repositório no GitHub
- Compatível com Docker Compose v2 (`docker compose`) e faz fallback para v1 (`docker-compose`)
- Suporta workspaces com múltiplas raízes
- Atalho `Ctrl+Shift+T` / `Cmd+Shift+T` abre o seletor de shell do compose

## Requisitos

- VS Code `^1.85.0`
- Docker CLI instalado e disponível no `PATH`
- Docker Compose v2 (recomendado) ou v1

## Uso

### Barra lateral Containers (qualquer workspace, mesmo sem docker-compose)

1. Clique no ícone **Containers** na barra lateral
2. O painel lista todos os containers em execução no host
3. Clique em um container — um terminal abre com `docker exec -it <id> <shell>`
4. Ícones inline na linha: `$(terminal)` shell · `$(play)` iniciar · `$(stop)` parar · `$(refresh)` reiniciar · `$(output)` logs
5. Use o botão **$(refresh)** no título da view para reescanear

### Barra lateral Compose Services (workspace com docker-compose.yml)

1. Clique no ícone **Compose Services** na barra lateral
2. O painel lista todos os serviços dos arquivos compose encontrados no workspace
3. Ícones inline na linha: `$(terminal)` shell · `$(play)` iniciar · `$(stop)` parar · `$(refresh)` reiniciar · `$(output)` logs
4. **Iniciar** executa `docker compose up -d <service>`, que respeita `depends_on` — dependências faltando/paradas são iniciadas antes
5. A view atualiza sozinha quando os arquivos compose mudam no disco

### Paleta de Comandos

1. **Docker Terminal: Open Shell in Service** — escolha arquivo compose → escolha serviço → terminal abre
2. **Docker Terminal: Open Shell in Container** — abre um shell em um container selecionado
3. Teclado: `Ctrl+Shift+T` (Linux/Windows) ou `Cmd+Shift+T` (macOS) para o seletor do compose

## Como funciona

1. Ao ativar, a extensão carrega duas entradas na barra lateral — **Containers** e **Compose Services** — além de um item de info na status bar mostrando o nome da extensão e a versão, com link clicável para o repositório no GitHub.
2. A view Containers executa `docker ps --no-trunc --format '{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Status}}'` e lista todos os containers em execução. A atualização é debounceada e roda automaticamente quando o painel se torna visível.
3. Clicar em um container executa `docker exec <container> getent passwd <user | 0>` para ler o shell padrão de login do container em `/etc/passwd`, então abre um terminal com `docker exec -it <id> <shell>`.
4. A view Compose observa `docker-compose.{yml,yaml}` e `compose.{yml,yaml}` via `FileSystemWatcher` e re-parseia com `js-yaml` em mudanças. Executar `docker compose up -d <service>` respeita `depends_on` — inicia o serviço e qualquer dependência faltando/parada, em ordem de declaração, antes de anexar.
5. Os ícones inline de `Logs` abrem um terminal dedicado pré-carregado com `docker compose logs -f <service>` ou `docker logs -f --details <container>` — `Ctrl+C` interrompe o tail.

Isso significa que containers baseados em Alpine recebem `ash`, Debian/Ubuntu recebem `bash`, e imagens customizadas com `zsh`/`fish` configurados como shell padrão funcionam sem ajustes — sem shell fixo no código.

## Configurações

| Configuração                      | Padrão                  | Descrição                                                                                                                                                                                                                                                                                   |
| --------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `composeTerminal.dockerCommand`   | `docker`                | Caminho ou nome do docker CLI                                                                                                                                                                                                                                                               |
| `composeTerminal.preferComposeV2` | `true`                  | Usar `docker compose` antes de cair no fallback `docker-compose`                                                                                                                                                                                                                            |
| `composeTerminal.composeFiles`    | `[]`                    | Caminhos explícitos de arquivos compose (vazio = autodetectar nas raízes do workspace)                                                                                                                                                                                                      |
| `composeTerminal.terminalName`    | `{service} • {project}` | Padrão de nome do terminal. Placeholders: `{service}`, `{project}`                                                                                                                                                                                                                          |
| `composeTerminal.clearOnExit`     | `true`                  | Enquadra o `docker compose exec` com um comando de limpeza do shell do host (`clear` em Linux/macOS, `cls` no Windows) — um antes de anexar e outro após sair — para que o terminal do VS Code seja limpo antes de entrar e depois de sair do container. Defina como `false` para desativar |

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

Outros scripts:

```bash
npm run watch      # build incremental com esbuild
npm run typecheck  # tsc --noEmit
```

## Estrutura do projeto

```
src/
├── extension.ts          # ponto de entrada, registro de comandos, views da barra lateral
├── compose/
│   ├── parser.ts         # parsing YAML, descoberta no workspace
│   ├── types.ts          # ComposeFileRef, ComposeProject, ComposeService
│   ├── validation.ts     # regexes de whitelist para service/shell/container
│   └── provider.ts       # TreeDataProvider da view Compose Services + file watcher
├── containers/
│   ├── types.ts          # ContainerInfo, ContainerTreeItem
│   └── provider.ts       # TreeDataProvider da view Containers
├── docker/
│   ├── client.ts         # wrapper do DockerClient (fallback v2 → v1, ps/listing, exec)
│   └── shell.ts          # detecção do shell padrão via /etc/passwd
├── host/
│   └── clearCommand.ts   # seleção de `clear`/`cls` por SO
├── info/
│   └── statusBar.ts      # item de info da extensão na status bar inferior
└── terminals/
    └── manager.ts        # ciclo de vida dos terminais do VS Code (compose e container)
test/                     # smoke tests (alguns exigem um daemon docker ativo)
```

## Licença

MIT

## Veja também

- [Guia de publicação](PUBLISHING.md) — como distribuir esta extensão nas lojas VS Code, Open VSX, TRAE e via GitHub Releases.
