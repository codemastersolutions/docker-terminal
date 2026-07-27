import {
  EventEmitter,
  FileSystemWatcher,
  MarkdownString,
  OutputChannel,
  ProviderResult,
  ThemeIcon,
  TreeDataProvider,
  TreeItem,
  TreeItemCollapsibleState,
  TreeView,
  workspace
} from 'vscode';
import { findComposeFiles, parseComposeFile } from './parser';
import type { ComposeFileRef, ComposeService } from './types';
import type { DockerClient } from '../docker/client';

const REFRESH_DEBOUNCE_MS = 300;
const COMPOSE_GLOB = '**/{docker-compose,compose}.{yml,yaml}';

/**
 * Argument carried by tree-item `command`. Lets the command handler in
 * extension.ts reach back to the compose file + service name.
 */
export interface ComposeServiceRef {
  composeFilePath: string;
  serviceName: string;
}

/**
 * Tree node model. Two kinds:
 *   - `group`   → a compose file header (collapsible, expands to its services)
 *   - `service` → a leaf service under a group (collapsible = None)
 *
 * `contextValue` is the string VS Code uses in `when` clauses for menus and
 * keybindings, so per-node type lets us target commands precisely.
 */
export class ComposeTreeItem {
  constructor(
    public readonly kind: 'group' | 'service',
    public readonly label: string,
    public readonly description: string | undefined,
    public readonly fileRef: ComposeFileRef,
    public readonly service: ComposeService | undefined,
    public readonly collapsibleState: TreeItemCollapsibleState
  ) {}
}

/**
 * Sidebar tree source for the **Compose Services** view.
 *
 * Walks the workspace for `docker-compose.{yml,yaml}` and `compose.{yml,yaml}`,
 * parses each, and emits a 2-level tree: one collapsible header per file,
 * services as leaves. Refresh is debounced and also triggered by a workspace
 * file watcher so editing a compose file updates the tree without a manual
 * refresh.
 */
export class ComposeTreeProvider implements TreeDataProvider<ComposeTreeItem> {
  private readonly _onDidChange = new EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChange.event;

  private items: ComposeTreeItem[] = [];
  private errorMessage: string | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private view: TreeView<ComposeTreeItem> | null = null;
  private watcher: FileSystemWatcher | null = null;
  private watcherDisposable: { dispose(): void } | null = null;

  constructor(
    private readonly docker: DockerClient,
    private readonly log: OutputChannel
  ) {}

  attachView(view: TreeView<ComposeTreeItem>): void {
    this.view = view;
    this.updateMessage();
  }

  refresh(): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      void this.load();
    }, REFRESH_DEBOUNCE_MS);
  }

  /**
   * Start watching workspace files matching the compose filename patterns.
   * Idempotent — calling twice replaces the previous watcher.
   */
  startWatching(): void {
    this.stopWatching();
    this.watcher = workspace.createFileSystemWatcher(COMPOSE_GLOB);
    const trigger = () => this.refresh();
    this.watcher.onDidChange(trigger);
    this.watcher.onDidCreate(trigger);
    this.watcher.onDidDelete(trigger);
    this.watcherDisposable = this.watcher;
  }

  stopWatching(): void {
    if (this.watcherDisposable) {
      this.watcherDisposable.dispose();
      this.watcherDisposable = null;
      this.watcher = null;
    }
  }

  getChildren(element?: ComposeTreeItem): ProviderResult<ComposeTreeItem[]> {
    if (!element) {
      // Root level: only groups. Services are rendered as children of their group.
      return this.items.filter((i) => i.kind === 'group');
    }
    if (element.kind !== 'group') return [];
    return this.items.filter(
      (i) => i.kind === 'service' && i.fileRef.path === element.fileRef.path
    );
  }

  getTreeItem(element: ComposeTreeItem): TreeItem {
    const ti = new TreeItem(element.label, element.collapsibleState);
    if (element.description) ti.description = element.description;
    if (element.kind === 'service' && element.service) {
      const svc = element.service;
      const running = svc.state === 'running';
      const tip = new MarkdownString(
        `**${svc.name}**\n\n` +
          `image: \`${svc.image ?? '(unset)'}\`\n\n` +
          (svc.workingDir ? `working_dir: \`${svc.workingDir}\`\n\n` : '') +
          `state: **${svc.state || 'stopped'}**\n\n` +
          `file: \`${element.fileRef.path}\``
      );
      tip.isTrusted = { enabledCommands: ['composeTerminal.composeShell'] };
      ti.tooltip = tip;
      ti.iconPath = new ThemeIcon(running ? 'server' : 'debug-stop');
      // Two context values drive per-row menu visibility:
      //   composeServiceRunning  → Stop / Restart / Logs visible, Start hidden
      //   composeServiceStopped  → Start visible, the rest hidden
      ti.contextValue = running ? 'composeServiceRunning' : 'composeServiceStopped';
      // Row click intentionally disabled — actions are exposed only via the
      // inline icons in `package.json` `view/item/context` so the user always
      // sees what they're triggering.
    } else {
      ti.tooltip = `${element.fileRef.path}`;
      ti.iconPath = new ThemeIcon('file');
      ti.contextValue = 'composeFile';
    }
    return ti;
  }

  private async load(): Promise<void> {
    const folders = workspace.workspaceFolders;
    const explicit =
      workspace.getConfiguration('composeTerminal').get<string[]>('composeFiles') ?? [];
    try {
      const refs = await findComposeFiles(folders, explicit);
      const flat: ComposeTreeItem[] = [];
      for (const ref of refs) {
        try {
          const project = await parseComposeFile(ref.path);
          // One `docker compose ps -a` per file returns a service→state map.
          // Services absent from the map keep an empty state (= stopped).
          const states = await this.docker.composeServiceStates(ref.path);
          const servicesWithState = project.services.map((svc) => ({
            ...svc,
            state: states.get(svc.name) ?? ''
          }));
          const runningCount = servicesWithState.filter(
            (s) => s.state === 'running'
          ).length;
          flat.push(
            new ComposeTreeItem(
              'group',
              ref.label,
              servicesWithState.length > 0
                ? `${runningCount}/${servicesWithState.length} running • ${project.name}`
                : `(no services) • ${project.name}`,
              ref,
              undefined,
              TreeItemCollapsibleState.Collapsed
            )
          );
          for (const svc of servicesWithState) {
            flat.push(
              new ComposeTreeItem(
                'service',
                svc.name,
                svc.image,
                ref,
                svc,
                TreeItemCollapsibleState.None
              )
            );
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this.log.appendLine(`[warn] compose parse failed for ${ref.path}: ${message}`);
          flat.push(
            new ComposeTreeItem(
              'group',
              ref.label,
              `parse error: ${message}`,
              ref,
              undefined,
              TreeItemCollapsibleState.None
            )
          );
        }
      }
      this.items = flat;
      this.errorMessage = null;
      this.log.appendLine(`[info] compose tree refresh: ${refs.length} file(s)`);
    } catch (err) {
      this.items = [];
      this.errorMessage = err instanceof Error ? err.message : String(err);
      this.log.appendLine(`[error] compose tree refresh failed: ${this.errorMessage}`);
    }
    this._onDidChange.fire();
    this.updateMessage();
  }

  private updateMessage(): void {
    if (!this.view) return;
    if (this.errorMessage) {
      this.view.message = `$(error) ${this.errorMessage}`;
    } else if (this.items.length === 0) {
      this.view.message =
        'No docker-compose.{yml,yaml} or compose.{yml,yaml} found in workspace.';
    } else {
      this.view.message = undefined;
    }
  }

  dispose(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.stopWatching();
    this._onDidChange.dispose();
  }
}