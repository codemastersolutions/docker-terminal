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
  workspace,
} from "vscode";
import { findComposeFiles, parseComposeFile } from "./parser";
import type { ComposeFileRef, ComposeService } from "./types";
import type { DockerClient } from "../docker/client";
import {
  discoverScripts,
  getParentFolderName,
  isInsideHiddenDir,
  ScriptEntry,
} from "../containers/scripts";
import type { ContainerInfo } from "../docker/client";

const REFRESH_DEBOUNCE_MS = 300;
const COMPOSE_GLOB = "**/{docker-compose,compose}.{yml,yaml}";

export interface ComposeServiceRef {
  composeFilePath: string;
  serviceName: string;
}

export type ComposeTreeItem =
  | ComposeGroupTreeItem
  | ComposeServiceTreeItem
  | ComposeFolderTreeItem
  | ComposeScriptTreeItem;

export class ComposeGroupTreeItem {
  readonly kind = "group" as const;
  constructor(
    public readonly label: string,
    public readonly description: string | undefined,
    public readonly fileRef: ComposeFileRef,
    public readonly projectName: string,
  ) {}
}

export class ComposeServiceTreeItem {
  readonly kind = "service" as const;
  constructor(
    public readonly label: string,
    public readonly description: string | undefined,
    public readonly fileRef: ComposeFileRef,
    public readonly service: ComposeService,
    public readonly projectName: string,
  ) {}
}

export class ComposeFolderTreeItem {
  readonly kind = "folder" as const;
  constructor(
    public readonly fileRef: ComposeFileRef,
    public readonly service: ComposeService,
    public readonly projectName: string,
    public readonly folderPath: string,
    public readonly folderName: string,
    public readonly scripts: ScriptEntry[],
  ) {}
}

export class ComposeScriptTreeItem {
  readonly kind = "script" as const;
  constructor(
    public readonly fileRef: ComposeFileRef,
    public readonly service: ComposeService,
    public readonly projectName: string,
    public readonly script: ScriptEntry,
  ) {}
}

export class ComposeTreeProvider implements TreeDataProvider<ComposeTreeItem> {
  private readonly _onDidChange = new EventEmitter<
    void | ComposeTreeItem | ComposeTreeItem[]
  >();
  readonly onDidChangeTreeData = this._onDidChange.event;

  private groups: ComposeGroupTreeItem[] = [];
  private servicesByGroup = new Map<string, ComposeServiceTreeItem[]>();
  private readonly scriptsByService = new Map<
    string,
    { containerId: string; scripts: ScriptEntry[] }
  >();
  private readonly loadPromises = new Map<string, Promise<void>>();
  private errorMessage: string | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private view: TreeView<ComposeTreeItem> | null = null;
  private watcher: FileSystemWatcher | null = null;
  private watcherDisposable: { dispose(): void } | null = null;

  constructor(
    private readonly docker: DockerClient,
    private readonly log: OutputChannel,
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

  invalidateForComposeFile(_composeFilePath: string): void {}

  getChildren(element?: ComposeTreeItem): ProviderResult<ComposeTreeItem[]> {
    if (!element) return this.groups;
    if (element.kind === "group") {
      return this.servicesByGroup.get(this.groupKey(element)) ?? [];
    }
    if (element.kind === "service") {
      return this.getFolderChildren(element);
    }
    if (element.kind === "folder") {
      return this.getScriptChildren(element);
    }
    return [];
  }

  private groupKey(g: ComposeGroupTreeItem): string {
    return g.fileRef.path;
  }

  private serviceKey(
    fileRef: ComposeFileRef,
    service: { name: string },
  ): string {
    return `${fileRef.path}::${service.name}`;
  }

  getTreeItem(element: ComposeTreeItem): TreeItem {
    if (element.kind === "group") {
      const ti = new TreeItem(
        element.label,
        TreeItemCollapsibleState.Collapsed,
      );
      if (element.description) ti.description = element.description;
      ti.tooltip = element.fileRef.path;
      ti.iconPath = new ThemeIcon("file");
      ti.contextValue = "composeFile";
      return ti;
    }
    if (element.kind === "service") {
      return this.buildServiceItem(element);
    }
    if (element.kind === "folder") {
      return this.buildFolderItem(element);
    }
    return this.buildScriptItem(element);
  }

  private buildServiceItem(element: ComposeServiceTreeItem): TreeItem {
    const svc = element.service;
    const running = svc.state === "running";
    const ti = new TreeItem(
      svc.name,
      running
        ? TreeItemCollapsibleState.Collapsed
        : TreeItemCollapsibleState.None,
    );
    if (svc.image) ti.description = svc.image;
    const tip = new MarkdownString(
      `**${svc.name}**\n\n` +
        `image: \`${svc.image ?? "(unset)"}\`\n\n` +
        (svc.workingDir ? `working_dir: \`${svc.workingDir}\`\n\n` : "") +
        `state: **${svc.state || "stopped"}**\n\n` +
        `file: \`${element.fileRef.path}\`` +
        (running
          ? "\n\nExpand to view `package.json` scripts and `Makefile` targets grouped by folder."
          : "\n\n*(Start the service to browse scripts inside its container.)*"),
    );
    tip.isTrusted = {
      enabledCommands: [
        "composeTerminal.composeShell",
        "composeTerminal.composeStart",
        "composeTerminal.composeStop",
        "composeTerminal.composeRestart",
        "composeTerminal.composeLogs",
        "composeTerminal.runContainerScript",
      ],
    };
    ti.tooltip = tip;
    ti.iconPath = new ThemeIcon(running ? "server" : "circle-slash");
    ti.contextValue = running
      ? "composeServiceRunning"
      : "composeServiceStopped";
    return ti;
  }

  private buildFolderItem(element: ComposeFolderTreeItem): TreeItem {
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
        `service: \`${element.service.name}\`\n\n` +
        `path: \`${element.folderPath}\`\n\n` +
        `${sources.join("\n\n")}\n\n` +
        `Expand to view individual scripts.`,
    );
    ti.tooltip = tip;
    ti.iconPath = new ThemeIcon("folder");
    ti.contextValue = "composeScriptsFolder";
    return ti;
  }

  private buildScriptItem(element: ComposeScriptTreeItem): TreeItem {
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
        `service: \`${element.service.name}\`\n\n` +
        `source: \`${element.script.source}\`\n\n` +
        `file: \`${element.script.filePath}\``,
    );
    ti.iconPath = new ThemeIcon(isPkg ? "package" : "tools");
    ti.contextValue = isPkg ? "composePkgScript" : "composeMakeTarget";
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
    svc: ComposeServiceTreeItem,
  ): Promise<ComposeTreeItem[]> {
    if (svc.service.state !== "running") return [];
    try {
      await this.ensureScriptsLoaded(svc);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.log.appendLine(
        `[warn] compose script discovery failed for ${svc.service.name}: ${message}`,
      );
      return [];
    }
    const entry = this.scriptsByService.get(
      this.serviceKey(svc.fileRef, svc.service),
    );
    if (!entry) return [];
    return this.groupScriptsByFolder(svc, entry.scripts);
  }

  private groupScriptsByFolder(
    parent: ComposeServiceTreeItem,
    scripts: ScriptEntry[],
  ): ComposeFolderTreeItem[] {
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
      return new ComposeFolderTreeItem(
        parent.fileRef,
        parent.service,
        parent.projectName,
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
    if (parent) return `${parent}/${folderName}`;
    return `${folderName} (${count + 1})`;
  }

  private getScriptChildren(folder: ComposeFolderTreeItem): ComposeTreeItem[] {
    return folder.scripts
      .sort((a, b) => {
        if (a.source !== b.source) return a.source === "package.json" ? -1 : 1;
        return a.name.localeCompare(b.name);
      })
      .map(
        (s) =>
          new ComposeScriptTreeItem(
            folder.fileRef,
            folder.service,
            folder.projectName,
            s,
          ),
      );
  }

  private ensureScriptsLoaded(svc: ComposeServiceTreeItem): Promise<void> {
    const key = this.serviceKey(svc.fileRef, svc.service);
    const existing = this.scriptsByService.get(key);
    if (existing) return Promise.resolve();
    const inFlight = this.loadPromises.get(key);
    if (inFlight) return inFlight;
    const promise = (async () => {
      try {
        const containerId = await this.docker.ensureRunning(
          svc.fileRef.path,
          svc.service.name,
        );
        const scripts = await discoverScripts(this.docker, containerId);
        this.scriptsByService.set(key, { containerId, scripts });
        this.log.appendLine(
          `[info] compose script discovery: ${svc.service.name} → ${scripts.length} script(s)`,
        );
        this._onDidChange.fire(svc);
      } finally {
        this.loadPromises.delete(key);
      }
    })();
    this.loadPromises.set(key, promise);
    return promise;
  }

  async resolveContainerInfoFromScript(
    element: ComposeScriptTreeItem,
  ): Promise<ContainerInfo> {
    const key = this.serviceKey(element.fileRef, element.service);
    let entry = this.scriptsByService.get(key);
    if (!entry) {
      const containerId = await this.docker.ensureRunning(
        element.fileRef.path,
        element.service.name,
      );
      const scripts = await discoverScripts(this.docker, containerId);
      entry = { containerId, scripts };
      this.scriptsByService.set(key, entry);
    }
    const all = await this.docker.listContainers();
    const found =
      all.find((c) => c.id === entry!.containerId) ??
      all.find(
        (c) =>
          c.labels?.["com.docker.compose.service"] === element.service.name,
      );
    if (found) return found;
    return {
      id: entry!.containerId,
      name: element.service.name,
      image: element.service.image ?? "",
      status: "",
      state: "running",
    };
  }

  private async load(): Promise<void> {
    const folders = workspace.workspaceFolders;
    const explicit =
      workspace
        .getConfiguration("composeTerminal")
        .get<string[]>("composeFiles") ?? [];
    try {
      const refs = await findComposeFiles(folders, explicit);
      const newGroups: ComposeGroupTreeItem[] = [];
      const newServices = new Map<string, ComposeServiceTreeItem[]>();
      for (const ref of refs) {
        try {
          const project = await parseComposeFile(ref.path);
          const states = await this.docker.composeServiceStates(ref.path);
          const servicesWithState = project.services.map((svc) => ({
            ...svc,
            state: states.get(svc.name) ?? "",
          }));
          const runningCount = servicesWithState.filter(
            (s) => s.state === "running",
          ).length;
          newGroups.push(
            new ComposeGroupTreeItem(
              ref.label,
              servicesWithState.length > 0
                ? `${runningCount}/${servicesWithState.length} running • ${project.name}`
                : `(no services) • ${project.name}`,
              ref,
              project.name,
            ),
          );
          const gKey = ref.path;
          const svcItems: ComposeServiceTreeItem[] = servicesWithState.map(
            (svc) =>
              new ComposeServiceTreeItem(
                svc.name,
                svc.image,
                ref,
                svc,
                project.name,
              ),
          );
          newServices.set(gKey, svcItems);
          const activeKeys = new Set(
            svcItems.map((s) => this.serviceKey(ref, s.service)),
          );
          for (const staleKey of Array.from(this.scriptsByService.keys())) {
            if (!staleKey.startsWith(`${ref.path}::`)) continue;
            if (!activeKeys.has(staleKey)) {
              this.scriptsByService.delete(staleKey);
              this.loadPromises.delete(staleKey);
            }
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this.log.appendLine(
            `[warn] compose parse failed for ${ref.path}: ${message}`,
          );
          newGroups.push(
            new ComposeGroupTreeItem(
              ref.label,
              `parse error: ${message}`,
              ref,
              "",
            ),
          );
        }
      }
      this.groups = newGroups;
      this.servicesByGroup = newServices;
      this.errorMessage = null;
      this.log.appendLine(
        `[info] compose tree refresh: ${refs.length} file(s)`,
      );
    } catch (err) {
      this.groups = [];
      this.servicesByGroup.clear();
      this.errorMessage = err instanceof Error ? err.message : String(err);
      this.log.appendLine(
        `[error] compose tree refresh failed: ${this.errorMessage}`,
      );
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
        "No docker-compose.{yml,yaml} or compose.{yml,yaml} found in workspace.";
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
    this.loadPromises.clear();
    this.scriptsByService.clear();
    this._onDidChange.dispose();
  }
}
