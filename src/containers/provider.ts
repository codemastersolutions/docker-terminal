import {
  EventEmitter,
  MarkdownString,
  OutputChannel,
  ProviderResult,
  ThemeIcon,
  TreeDataProvider,
  TreeItem,
  TreeItemCollapsibleState,
  TreeView
} from 'vscode';
import { DockerClient } from '../docker/client';
import { ContainerTreeItem } from './types';

const REFRESH_DEBOUNCE_MS = 200;

/**
 * Sidebar tree source for the **Containers** view.
 *
 * Sources from `docker ps -a` so a workspace without any
 * docker-compose.{yml,yaml} still lists every container on the host — running
 * or stopped. The per-row `.State` column decides which lifecycle icons
 * (`Start` / `Stop` / `Restart` / `Logs`) appear via `contextValue`.
 * Refreshing is debounced to coalesce repeated clicks while a previous load
 * is still in flight.
 */
export class ContainerTreeProvider implements TreeDataProvider<ContainerTreeItem> {
  private readonly _onDidChange = new EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChange.event;

  private items: ContainerTreeItem[] = [];
  private errorMessage: string | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private view: TreeView<ContainerTreeItem> | null = null;

  constructor(
    private readonly docker: DockerClient,
    private readonly log: OutputChannel
  ) {}

  /**
   * Bind the underlying `TreeView` so the provider can surface status messages
   * (loading state, errors, "no containers" hint) via `view.message`.
   */
  attachView(view: TreeView<ContainerTreeItem>): void {
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

  getChildren(): ProviderResult<ContainerTreeItem[]> {
    return this.items;
  }

  getTreeItem(element: ContainerTreeItem): TreeItem {
    const running = element.info.state === 'running';
    const ti = new TreeItem(element.info.name, TreeItemCollapsibleState.None);
    ti.description = `${element.info.image || element.info.id} • ${element.info.state || 'unknown'}`;
    const tip = new MarkdownString(
      `**${element.info.name}**\n\n` +
        `\`${element.info.id}\`\n\n` +
        `image: \`${element.info.image}\`\n\n` +
        `state: **${element.info.state || 'unknown'}**\n\n` +
        `status: ${element.info.status}`
    );
    tip.isTrusted = { enabledCommands: ['composeTerminal.attachContainer'] };
    ti.tooltip = tip;
    ti.iconPath = new ThemeIcon(running ? 'container' : 'debug-stop');
    // Two context values drive per-row menu visibility:
    //   runningContainer  → Stop / Restart / Logs visible, Start hidden
    //   stoppedContainer  → Start visible, the rest hidden
    ti.contextValue = running ? 'runningContainer' : 'stoppedContainer';
    // Row click intentionally disabled — actions are exposed only via the
    // inline icons in `package.json` `view/item/context` so the user always
    // sees what they're triggering.
    return ti;
  }

  private async load(): Promise<void> {
    try {
      const list = await this.docker.listContainers();
      this.items = list.map((c) => new ContainerTreeItem(c));
      this.errorMessage = null;
      const running = list.filter((c) => c.state === 'running').length;
      this.log.appendLine(
        `[info] refresh: ${list.length} container(s) (${running} running)`
      );
    } catch (err) {
      this.items = [];
      this.errorMessage = err instanceof Error ? err.message : String(err);
      this.log.appendLine(`[error] refresh failed: ${this.errorMessage}`);
    }
    this._onDidChange.fire();
    this.updateMessage();
  }

  private updateMessage(): void {
    if (!this.view) return;
    if (this.errorMessage) {
      this.view.message = `$(error) ${this.errorMessage}`;
    } else if (this.items.length === 0) {
      this.view.message = 'No containers. Start one with `docker compose up` or `docker run`.';
    } else {
      this.view.message = undefined;
    }
  }

  dispose(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    this._onDidChange.dispose();
  }
}
