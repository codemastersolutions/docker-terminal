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
 * Sidebar tree source for the **Running Containers** view.
 *
 * Sources from `docker ps` directly so a workspace without any
 * docker-compose.{yml,yaml} still lists every container running on the host.
 * Refreshing is debounced to coalesce repeated clicks while a previous load is
 * still in flight.
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
    const ti = new TreeItem(element.info.name, TreeItemCollapsibleState.None);
    ti.description = element.info.image || element.info.id;
    const tip = new MarkdownString(
      `**${element.info.name}**\n\n` +
        `\`${element.info.id}\`\n\n` +
        `image: \`${element.info.image}\`\n\n` +
        `status: ${element.info.status}\n\n` +
        `_Click to attach a shell_`
    );
    tip.isTrusted = { enabledCommands: ['composeTerminal.attachContainer'] };
    ti.tooltip = tip;
    ti.iconPath = new ThemeIcon('container');
    ti.contextValue = 'runningContainer';
    ti.command = {
      command: 'composeTerminal.attachContainer',
      title: 'Open Shell in Container',
      arguments: [element.info]
    };
    return ti;
  }

  private async load(): Promise<void> {
    try {
      const list = await this.docker.listRunningContainers();
      this.items = list.map((c) => new ContainerTreeItem(c));
      this.errorMessage = null;
      this.log.appendLine(`[info] refresh: ${list.length} running container(s)`);
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
      this.view.message = 'No running containers. Start one with `docker compose up` or `docker run`.';
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
