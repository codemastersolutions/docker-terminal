import {
  EventEmitter,
  MarkdownString,
  OutputChannel,
  ProviderResult,
  ThemeIcon,
  TreeDataProvider,
  TreeItem,
  TreeItemCollapsibleState,
  TreeView,
} from "vscode";
import { DockerClient } from "../docker/client";
import {
  ContainerFolderTreeItem,
  ContainerGroupTreeItem,
  ContainerScriptTreeItem,
  ContainerTreeItem,
} from "./types";
import {
  discoverScripts,
  getParentFolderName,
  isInsideHiddenDir,
  ScriptEntry,
} from "./scripts";

const REFRESH_DEBOUNCE_MS = 200;

export class ContainerTreeProvider implements TreeDataProvider<ContainerTreeItem> {
  private readonly _onDidChange = new EventEmitter<
    void | ContainerTreeItem | ContainerTreeItem[]
  >();
  readonly onDidChangeTreeData = this._onDidChange.event;

  private groups: ContainerGroupTreeItem[] = [];
  private readonly scriptsByContainer = new Map<string, ScriptEntry[]>();
  private readonly loadPromises = new Map<string, Promise<void>>();
  private errorMessage: string | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private view: TreeView<ContainerTreeItem> | null = null;

  constructor(
    private readonly docker: DockerClient,
    private readonly log: OutputChannel,
  ) {}

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

  invalidateScripts(containerIdOrName: string): void {
    this.scriptsByContainer.delete(containerIdOrName);
    this.loadPromises.delete(containerIdOrName);
  }

  getChildren(
    element?: ContainerTreeItem,
  ): ProviderResult<ContainerTreeItem[]> {
    if (!element) return this.groups;
    if (element.kind === "container") return this.getFolderChildren(element);
    if (element.kind === "folder") return this.getScriptChildren(element);
    return [];
  }

  getTreeItem(element: ContainerTreeItem): TreeItem {
    if (element.kind === "container") {
      return this.buildContainerItem(element);
    }
    if (element.kind === "folder") {
      return this.buildFolderItem(element);
    }
    return this.buildScriptItem(element);
  }

  private buildContainerItem(element: ContainerGroupTreeItem): TreeItem {
    const running = element.info.state === "running";
    const ti = new TreeItem(
      element.info.name,
      TreeItemCollapsibleState.Collapsed,
    );
    ti.description = `${element.info.image || element.info.id} • ${element.info.state || "unknown"}`;
    const tip = new MarkdownString(
      `**${element.info.name}**\n\n` +
        `\`${element.info.id}\`\n\n` +
        `image: \`${element.info.image}\`\n\n` +
        `state: **${element.info.state || "unknown"}**\n\n` +
        `status: ${element.info.status}\n\n` +
        `Expand to view \`package.json\` scripts and \`Makefile\` targets grouped by folder.`,
    );
    tip.isTrusted = {
      enabledCommands: [
        "composeTerminal.attachContainer",
        "composeTerminal.showContainerScripts",
        "composeTerminal.containerStart",
        "composeTerminal.containerStop",
        "composeTerminal.containerRestart",
        "composeTerminal.containerLogs",
        "composeTerminal.runContainerScript",
      ],
    };
    ti.tooltip = tip;
    ti.iconPath = new ThemeIcon(running ? "container" : "circle-slash");
    ti.contextValue = running ? "runningContainer" : "stoppedContainer";
    return ti;
  }

  private buildFolderItem(element: ContainerFolderTreeItem): TreeItem {
    const hasPkg = element.scripts.some((s) => s.source === "package.json");
    const hasMake = element.scripts.some((s) => s.source === "Makefile");
    const pkgCount = element.scripts.filter(
      (s) => s.source === "package.json",
    ).length;
    const makeCount = element.scripts.filter(
      (s) => s.source === "Makefile",
    ).length;

    const sources: string[] = [];
    if (hasPkg) sources.push(`${pkgCount} package.json script(s)`);
    if (hasMake) sources.push(`${makeCount} Makefile target(s)`);

    const ti = new TreeItem(
      element.folderName,
      TreeItemCollapsibleState.Collapsed,
    );
    ti.description = element.folderPath;
    const tip = new MarkdownString(
      `**${element.folderName}**\n\n` +
        `path: \`${element.folderPath}\`\n\n` +
        `${sources.join("\n\n")}\n\n` +
        `Expand to view individual scripts.`,
    );
    ti.tooltip = tip;
    ti.iconPath = new ThemeIcon("folder");
    ti.contextValue = "scriptsFolder";
    ti.resourceUri = undefined;
    return ti;
  }

  private buildScriptItem(element: ContainerScriptTreeItem): TreeItem {
    const isPkg = element.script.source === "package.json";
    const label = element.script.name;
    const ti = new TreeItem(label, TreeItemCollapsibleState.None);
    ti.description = element.script.command;
    ti.tooltip = new MarkdownString(
      (isPkg
        ? `**npm run ${element.script.name}**`
        : `**make ${element.script.name}**`) +
        "\n\n" +
        `\`\`\`bash\n${element.script.command}\n\`\`\`\n\n` +
        `source: \`${element.script.source}\`\n\n` +
        `file: \`${element.script.filePath}\``,
    );
    ti.iconPath = new ThemeIcon(isPkg ? "package" : "tools");
    ti.contextValue = isPkg ? "containerPkgScript" : "containerMakeTarget";
    ti.command = {
      title: isPkg
        ? `Run npm run ${element.script.name}`
        : `Run make ${element.script.name}`,
      command: "composeTerminal.runContainerScript",
      arguments: [element],
    };
    return ti;
  }

  private async getFolderChildren(
    group: ContainerGroupTreeItem,
  ): Promise<ContainerTreeItem[]> {
    if (group.info.state !== "running") return [];
    try {
      await this.ensureScriptsLoaded(group);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.log.appendLine(
        `[warn] script discovery failed for ${group.info.name}: ${message}`,
      );
      return [];
    }
    const scripts = this.scriptsByContainer.get(group.info.id) ?? [];
    return this.groupScriptsByFolder(group.info, scripts);
  }

  private groupScriptsByFolder(
    parentInfo: ContainerGroupTreeItem["info"],
    scripts: ScriptEntry[],
  ): ContainerFolderTreeItem[] {
    const folderMap = new Map<
      string,
      { folderPath: string; folderName: string; scripts: ScriptEntry[] }
    >();

    for (const script of scripts) {
      if (isInsideHiddenDir(script.filePath)) continue;
      const { folderPath, folderName } = getParentFolderName(script.filePath);
      if (folderName.startsWith(".")) continue;
      if (!folderMap.has(folderPath)) {
        folderMap.set(folderPath, {
          folderPath,
          folderName,
          scripts: [],
        });
      }
      folderMap.get(folderPath)!.scripts.push(script);
    }

    const entries = Array.from(folderMap.values());
    entries.sort((a, b) => {
      if (a.folderPath === "/" && b.folderPath !== "/") return -1;
      if (a.folderPath !== "/" && b.folderPath === "/") return 1;
      return a.folderPath.localeCompare(b.folderPath);
    });

    const uniqueNames = new Map<string, number>();
    return entries.map((entry) => {
      const displayName = this.buildDisplayName(
        entry.folderName,
        entry.folderPath,
        uniqueNames,
      );
      return new ContainerFolderTreeItem(
        parentInfo,
        entry.folderPath,
        displayName,
        entry.scripts,
      );
    });
  }

  private buildDisplayName(
    folderName: string,
    folderPath: string,
    uniqueNames: Map<string, number>,
  ): string {
    const key = folderName.toLowerCase();
    const count = uniqueNames.get(key) ?? 0;
    uniqueNames.set(key, count + 1);

    if (count === 0) return folderName;

    const parts = folderPath.split("/").filter(Boolean);
    const parentIdx = parts.length - 2;
    const parent = parentIdx >= 0 ? parts[parentIdx] : null;
    if (parent) {
      return `${parent}/${folderName}`;
    }
    return `${folderName} (${count + 1})`;
  }

  private async getScriptChildren(
    folder: ContainerFolderTreeItem,
  ): Promise<ContainerTreeItem[]> {
    return folder.scripts
      .sort((a, b) => {
        if (a.source !== b.source) return a.source === "package.json" ? -1 : 1;
        return a.name.localeCompare(b.name);
      })
      .map((s) => new ContainerScriptTreeItem(folder.parentInfo, s));
  }

  private ensureScriptsLoaded(group: ContainerGroupTreeItem): Promise<void> {
    const existing = this.scriptsByContainer.get(group.info.id);
    if (existing) return Promise.resolve();
    const inFlight = this.loadPromises.get(group.info.id);
    if (inFlight) return inFlight;
    const promise = (async () => {
      try {
        const scripts = await discoverScripts(this.docker, group.info.id);
        this.scriptsByContainer.set(group.info.id, scripts);
        this.log.appendLine(
          `[info] script discovery: ${group.info.name} → ${scripts.length} script(s)`,
        );
        this._onDidChange.fire(group);
      } finally {
        this.loadPromises.delete(group.info.id);
      }
    })();
    this.loadPromises.set(group.info.id, promise);
    return promise;
  }

  private async load(): Promise<void> {
    try {
      const list = await this.docker.listContainers();
      const newGroups = list.map((c) => new ContainerGroupTreeItem(c));
      const validIds = new Set(list.map((c) => c.id));
      for (const staleId of Array.from(this.scriptsByContainer.keys())) {
        if (!validIds.has(staleId)) {
          this.scriptsByContainer.delete(staleId);
          this.loadPromises.delete(staleId);
        }
      }
      this.groups = newGroups;
      this.errorMessage = null;
      const running = list.filter((c) => c.state === "running").length;
      this.log.appendLine(
        `[info] refresh: ${list.length} container(s) (${running} running)`,
      );
    } catch (err) {
      this.groups = [];
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
    } else if (this.groups.length === 0) {
      this.view.message =
        "No containers. Start one with `docker compose up` or `docker run`.";
    } else {
      this.view.message = undefined;
    }
  }

  dispose(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.loadPromises.clear();
    this.scriptsByContainer.clear();
    this._onDidChange.dispose();
  }
}
