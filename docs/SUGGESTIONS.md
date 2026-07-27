# Sugestões de Features

Brainstorm de melhorias futuras para a extensão **Docker Terminal**. Organizado por
impacto vs esforço. Estudo posterior — nenhum item está no roadmap imediato.

> Status atual da extensão: 2 sidebar views (Containers + Compose Services),
> 5 ações inline por linha (Start / Stop / Restart / Logs / Shell), abertura de
> terminal via `docker exec` / `docker compose exec`, file watcher nos compose
> files. Sem auto-refresh, sem Webview, sem Inspect.

---

## Alto valor · esforço médio

### 1. Logs viewer dedicado (Webview)
Substitui o atual `docker logs -f` em terminal por um painel próprio.

- Stream ao vivo via `docker logs -f`.
- Busca incremental (`Ctrl+F`).
- Filtro por stdout / stderr (cores distintas).
- Toggle de timestamps.
- Botão "copiar" + "clear".
- Persiste filtro entre recargas.

### 2. Container Inspect
Árvore formatada com `docker inspect <container>`.

- Mostra: env vars, mounts, network, ports, IP, labels, cmd, entrypoint.
- Botão "Inspect" no clique direito da view Containers.
- Toggle JSON ↔ formatted tree.

### 3. Port mapping click-to-open
Mostra os port mappings na `description` da linha do container.

- Formato: `0.0.0.0:8080->80/tcp`.
- Click abre `http://localhost:8080` no browser default (configurável).
- Detecta `tls://` e abre como `vscode://` quando aplicável.

### 4. Compose file recursivo
Hoje `findComposeFiles` só checa a raiz do workspace.

- Busca `docker-compose.{yml,yaml}` em subpastas até N níveis (configurável, default 3).
- Cada arquivo vira um grupo separado na tree (igual já acontece).
- Suporte a monorepos com múltiplos compose files por subprojeto.

### 5. Compose validation on save
Valida o YAML automaticamente ao salvar.

- Roda `docker compose config -q` no arquivo.
- Erro vira `Diagnostic` no editor (squiggly + Problems panel).
- Quick fix opcional quando o erro é simples (yaml malformado).

---

## Médio valor · esforço baixo

### 6. Image tree
Terceira view na sidebar: `Images`.

- Lista imagens locais com tag, size, created.
- Filtro por dangling.
- Prune de dangling / all via command palette.

### 7. Volume / Network trees
Mesma mecânica das outras duas views.

- Volumes: listar + remove.
- Networks: listar + containers attached + remove.

### 8. Compose recreate / pull
Botões extras na view Compose Services.

- **Recreate**: `docker compose up -d --force-recreate <service>`.
- **Pull**: `docker compose pull <service>` antes de `up -d`.
- Útil quando o Dockerfile local mudou.

### 9. Healthcheck indicator
Ícone colorido por health status.

- `$(pulse)` verde para `healthy`.
- `$(warning)` amarelo para `starting`.
- `$(error)` vermelho para `unhealthy`.
- Tooltip mostra última saída do healthcheck.

### 10. Multi-select actions
Checkbox nas trees + ações em lote.

- Stop All / Restart All.
- Stop Selected / Restart Selected.
- Útil pra desligar dev environment inteiro de uma vez.

---

## Baixo valor · polimento

### 11. Status bar widget
- Mostra count running/stopped na barra inferior.
- Click cicla entre as views.

### 12. Shell picker
- QuickPick (`bash` / `sh` / `zsh` / `ash`) antes de abrir terminal.
- Default ainda é auto-detect.

### 13. Prune commands
- `docker container prune`, `docker image prune`, `docker system prune` no command palette.
- Confirmação antes de executar.

### 14. Dockerfile snippets
- Templates pra `FROM`, `COPY`, `RUN`, `WORKDIR`, `ENTRYPOINT`, etc.
- Ativação por linguagem `dockerfile`.

### 15. Exec arbitrário
- Input box → `docker exec <id> <cmd>`.
- Output no Output Channel (mesmo do shell).
- Útil pra scripts one-off sem abrir terminal.

---

## Top picks pra primeiro sprint

1. **Logs viewer dedicado** — dor #1 hoje, terminal ruim pra logs grandes.
2. **Container Inspect** — informação que o `docker ps` não mostra.
3. **Port mapping click-to-open** — feature pequena, alto retorno.
4. **Compose file recursivo** — habilita monorepos out-of-the-box.
5. **Compose validation on save** — feedback no editor é UX premium.

Os 5 cobrem os gaps mais痛感áveis sem bloatar a extensão.

---

## Notas

- Webview exige bastante cuidado com lifecycle (dispose, restart de stream,
  CSP). Começar pelo Logs viewer pra aprender o caminho antes de replicar.
- `docker inspect` retorna JSON grande — tree virtualized é obrigatório
  (senão trava a view com 500+ nodes).
- "Multi-select" depende de `TreeView.selection` events — testar antes com
  checkbox custom ou usar o selection nativo do VS Code.