# Docker Terminal

Uma extensão do VS Code que abre um terminal em um serviço do `docker-compose` usando o **shell padrão de login do container** (lido de `/etc/passwd`), e não um `bash`/`sh` fixo no código.

> 🌐 **Idiomas:** [English](README.md) · [Português (Brasil)](README.pt-br.md) · [Español](README.es.md)

## Funcionalidades

- Lista os serviços de qualquer `docker-compose.{yml,yaml}` ou `compose.{yml,yaml}` no workspace
- Abre um terminal real anexado via `docker compose exec`
- Inicia o container automaticamente se ele estiver parado
- Detecta o shell padrão de login do container por serviço (`/bin/bash`, `/bin/zsh`, `/bin/ash`, etc.)
- Compatível com Docker Compose v2 (`docker compose`) e faz fallback para v1 (`docker-compose`)
- Suporta workspaces com múltiplas raízes

## Requisitos

- VS Code `^1.85.0`
- Docker CLI instalado e disponível no `PATH`
- Docker Compose v2 (recomendado) ou v1

## Uso

1. Abra um workspace que contenha um `docker-compose.yml`
2. Execute **Docker Terminal: Open Shell in Service** na Paleta de Comandos
3. Escolha um arquivo compose (essa etapa é pulada se houver apenas um)
4. Escolha um serviço
5. Um terminal é aberto com o shell padrão do container

## Como funciona

1. A extensão varre as raízes do workspace em busca de arquivos `docker-compose.{yml,yaml}` e `compose.{yml,yaml}` (ou usa a lista explícita definida em `composeTerminal.composeFiles`).
2. Faz o parse de cada arquivo compose com `js-yaml` e lista as entradas de `services`.
3. Quando você escolhe um serviço, a extensão executa `docker compose up -d <service>` (ou `docker-compose`, na v1) caso o container esteja parado.
4. Roda `docker exec <container> getent passwd <user | 0>` para ler o shell padrão de login do container em `/etc/passwd`.
5. Um terminal do VS Code é aberto e `docker compose exec -it <service> <shell>` é executado dentro dele.

Isso significa que containers baseados em Alpine recebem `ash`, Debian/Ubuntu recebem `bash`, e imagens customizadas com `zsh`/`fish` configurados como shell padrão funcionam sem ajustes — sem shell fixo no código.

## Configurações

| Configuração | Padrão | Descrição |
|---|---|---|
| `composeTerminal.dockerCommand` | `docker` | Caminho ou nome do docker CLI |
| `composeTerminal.preferComposeV2` | `true` | Usar `docker compose` antes de cair no fallback `docker-compose` |
| `composeTerminal.composeFiles` | `[]` | Caminhos explícitos de arquivos compose (vazio = autodetectar nas raízes do workspace) |
| `composeTerminal.terminalName` | `{service} • {project}` | Padrão de nome do terminal. Placeholders: `{service}`, `{project}` |
| `composeTerminal.clearTerminalAfterMs` | `1500` | ms para aguardar antes de enviar a sequência ANSI de limpar a tela, escondendo o ruído do shell do host. Defina como `0` para desativar |

## Comandos

| Comando | Título |
|---|---|
| `compose.openShell` | Docker Terminal: Open Shell in Service |

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
├── extension.ts          # ponto de entrada, registro de comandos
├── compose/
│   ├── parser.ts         # parsing YAML, descoberta no workspace
│   └── types.ts          # ComposeFileRef, ComposeProject, ComposeService
├── docker/
│   ├── client.ts         # wrapper do DockerClient (fallback v2 → v1)
│   └── shell.ts          # detecção do shell padrão via /etc/passwd
└── terminals/
    └── manager.ts        # ciclo de vida dos terminais do VS Code
test/                     # smoke tests (exigem um daemon docker ativo)
```

## Licença

MIT

## Veja também

- [Guia de publicação](PUBLISHING.md) — como distribuir esta extensão nas lojas VS Code, Open VSX, TRAE e via GitHub Releases.