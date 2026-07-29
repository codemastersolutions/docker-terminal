import {
  commands,
  env,
  ExtensionContext,
  OutputChannel,
  ProgressLocation,
  QuickPickItem,
  Uri,
  window,
  workspace
} from 'vscode';
import * as path from 'path';
import { findComposeFiles, parseComposeFile } from './compose/parser';
import { ComposeServiceRef, ComposeTreeProvider } from './compose/provider';
import type { ComposeFileRef, ComposeProject, ComposeService } from './compose/types';
import { isValidContainerId, isValidContainerName } from './compose/validation';
import { ContainerTreeProvider } from './containers/provider';
import { ContainerInfo, DockerClient } from './docker/client';
import { detectDefaultShell } from './docker/shell';
import { InfoStatusBar } from './info/statusBar';
import { TerminalManager } from './terminals/manager';

export async function activate(context: ExtensionContext): Promise<void> {
  const config = workspace.getConfiguration('composeTerminal');
  const docker = new DockerClient({
    dockerCommand: config.get<string>('dockerCommand') ?? 'docker',
    preferComposeV2: config.get<boolean>('preferComposeV2') ?? true
  });
  // Dedicated output channel — toast notifications disappear too quickly to
  // diagnose a regression. The channel name is the literal string
  // `Docker Terminal` so the user finds it in the Output panel dropdown.
  const log: OutputChannel = window.createOutputChannel('Docker Terminal');
  context.subscriptions.push(log);
  const terminalManager = new TerminalManager(log);
  const containerProvider = new ContainerTreeProvider(docker, log);

  const containersView = window.createTreeView('dockerTerminal-servicesView', {
    treeDataProvider: containerProvider,
    showCollapseAll: false
  });
  containerProvider.attachView(containersView);
  context.subscriptions.push(
    containersView,
    containerProvider,
    containersView.onDidChangeVisibility((e) => {
      if (e.visible) containerProvider.refresh();
    })
  );

  const composeTreeProvider = new ComposeTreeProvider(docker, log);
  composeTreeProvider.startWatching();
  const composeView = window.createTreeView('dockerTerminal-composeView', {
    treeDataProvider: composeTreeProvider,
    showCollapseAll: true
  });
  composeTreeProvider.attachView(composeView);
  context.subscriptions.push(
    composeView,
    composeTreeProvider,
    composeView.onDidChangeVisibility((e) => {
      if (e.visible) composeTreeProvider.refresh();
    })
  );

  const openShell = commands.registerCommand('compose.openShell', async () => {
    try {
      const explicit = workspace
        .getConfiguration('composeTerminal')
        .get<string[]>('composeFiles') ?? [];

      const files = await findComposeFiles(workspace.workspaceFolders, explicit);
      if (files.length === 0) {
        void window.showErrorMessage(
          'Docker Terminal: no docker-compose.{yml,yaml} or compose.{yml,yaml} found in workspace.'
        );
        return;
      }

      const fileRef = await pickComposeFile(files);
      if (!fileRef) return;

      const project = await parseComposeFile(fileRef.path);
      if (project.services.length === 0) {
        void window.showErrorMessage(
          `Docker Terminal: no services defined in ${fileRef.label}.`
        );
        return;
      }

      const service = await pickService(project.services);
      if (!service) return;

      await openShellForService({
        docker,
        terminalManager,
        project,
        service,
        fileRef
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const truncated = message.length > 500 ? `${message.slice(0, 500)}…` : message;
      log.appendLine(`[error] compose.openShell failed: ${truncated}`);
      log.appendLine(err instanceof Error && err.stack ? err.stack : '(no stack)');
      void window.showErrorMessage(`Docker Terminal: ${truncated}`);
    }
  });

  const refreshContainers = commands.registerCommand(
    'composeTerminal.refreshContainers',
    () => {
      containerProvider.refresh();
    }
  );

  const attachContainer = commands.registerCommand(
    'composeTerminal.attachContainer',
    async (arg: unknown) => {
      const info = normalizeContainerArg(arg);
      if (!info) {
        log.appendLine('[warn] attachContainer invoked without a valid container ref');
        void window.showErrorMessage(
          'Docker Terminal: attachContainer invoked without a valid container ref.'
        );
        return;
      }
      log.appendLine(`[info] attachContainer: id=${info.id} name=${info.name} image=${info.image}`);
      try {
        await attachToRunningContainer(docker, terminalManager, info, log);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const truncated = message.length > 500 ? `${message.slice(0, 500)}…` : message;
        log.appendLine(`[error] attachContainer failed: ${truncated}`);
        log.appendLine(err instanceof Error && err.stack ? err.stack : '(no stack)');
        void window.showErrorMessage(`Docker Terminal: ${truncated}`);
      }
    }
  );

  const refreshCompose = commands.registerCommand(
    'composeTerminal.refreshCompose',
    () => composeTreeProvider.refresh()
  );

  const composeShell = commands.registerCommand(
    'composeTerminal.composeShell',
    async (arg: unknown) => {
      const ref = normalizeServiceRef(arg);
      if (!ref) {
        log.appendLine('[warn] composeShell invoked without a valid service ref');
        void window.showErrorMessage(
          'Docker Terminal: composeShell invoked without a valid service ref.'
        );
        return;
      }
      try {
        await runShellAction(docker, terminalManager, ref);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const truncated = message.length > 500 ? `${message.slice(0, 500)}…` : message;
        log.appendLine(`[error] composeShell failed: ${truncated}`);
        log.appendLine(err instanceof Error && err.stack ? err.stack : '(no stack)');
        void window.showErrorMessage(`Docker Terminal: ${truncated}`);
      }
    }
  );

  const composeStart = commands.registerCommand(
    'composeTerminal.composeStart',
    async (arg: unknown) => {
      const ref = normalizeServiceRef(arg);
      if (!ref) return invalidRefWarn(log, 'composeStart');
      // `docker compose up -d <service>` honours `depends_on` automatically:
      // it starts the service and any dependency that is missing or stopped,
      // in declaration order, before attaching the requested service. So this
      // single command satisfies both "start the service" and "start its
      // dependencies first".
      await runComposeLifecycle(
        docker,
        log,
        ref,
        ['up', '-d', ref.serviceName],
        `Starting ${ref.serviceName} (and dependencies)…`,
        [containerProvider, composeTreeProvider]
      ).catch((err) => lifecycleError(log, 'composeStart', err));
    }
  );

  const composeStop = commands.registerCommand(
    'composeTerminal.composeStop',
    async (arg: unknown) => {
      const ref = normalizeServiceRef(arg);
      if (!ref) return invalidRefWarn(log, 'composeStop');
      await runComposeLifecycle(
        docker,
        log,
        ref,
        ['stop', ref.serviceName],
        `Stopping ${ref.serviceName}…`,
        [containerProvider, composeTreeProvider]
      ).catch((err) => lifecycleError(log, 'composeStop', err));
    }
  );

  const composeRestart = commands.registerCommand(
    'composeTerminal.composeRestart',
    async (arg: unknown) => {
      const ref = normalizeServiceRef(arg);
      if (!ref) return invalidRefWarn(log, 'composeRestart');
      await runComposeLifecycle(
        docker,
        log,
        ref,
        ['restart', ref.serviceName],
        `Restarting ${ref.serviceName}…`,
        [containerProvider, composeTreeProvider]
      ).catch((err) => lifecycleError(log, 'composeRestart', err));
    }
  );

  const composeLogs = commands.registerCommand(
    'composeTerminal.composeLogs',
    async (arg: unknown) => {
      const ref = normalizeServiceRef(arg);
      if (!ref) return invalidRefWarn(log, 'composeLogs');
      openComposeLogsTerminal(docker, ref);
    }
  );

  // Container lifecycle commands — operate on a container by id/name.
  // Shell is already wired to `composeTerminal.attachContainer` via row click;
  // these add Start / Stop / Restart / Logs as inline icons next to each row,
  // gated by `viewItem` in `package.json` so only the appropriate ones appear.
  const containerStart = commands.registerCommand(
    'composeTerminal.containerStart',
    async (arg: unknown) => {
      const info = normalizeContainerArg(arg);
      if (!info) return invalidContainerWarn(log, 'containerStart');
      await runContainerLifecycle(
        docker,
        log,
        info,
        ['start', info.id],
        `Starting ${info.name}…`,
        [containerProvider, composeTreeProvider]
      ).catch((err) => lifecycleError(log, 'containerStart', err));
    }
  );

  const containerStop = commands.registerCommand(
    'composeTerminal.containerStop',
    async (arg: unknown) => {
      const info = normalizeContainerArg(arg);
      if (!info) return invalidContainerWarn(log, 'containerStop');
      await runContainerLifecycle(
        docker,
        log,
        info,
        ['stop', info.id],
        `Stopping ${info.name}…`,
        [containerProvider, composeTreeProvider]
      ).catch((err) => lifecycleError(log, 'containerStop', err));
    }
  );

  const containerRestart = commands.registerCommand(
    'composeTerminal.containerRestart',
    async (arg: unknown) => {
      const info = normalizeContainerArg(arg);
      if (!info) return invalidContainerWarn(log, 'containerRestart');
      await runContainerLifecycle(
        docker,
        log,
        info,
        ['restart', info.id],
        `Restarting ${info.name}…`,
        [containerProvider]
      ).catch((err) => lifecycleError(log, 'containerRestart', err));
    }
  );

  const containerLogs = commands.registerCommand(
    'composeTerminal.containerLogs',
    async (arg: unknown) => {
      const info = normalizeContainerArg(arg);
      if (!info) return invalidContainerWarn(log, 'containerLogs');
      openContainerLogsTerminal(docker, info);
    }
  );

  context.subscriptions.push(
    openShell,
    refreshContainers,
    refreshCompose,
    attachContainer,
    composeShell,
    composeStart,
    composeStop,
    composeRestart,
    composeLogs,
    containerStart,
    containerStop,
    containerRestart,
    containerLogs,
    terminalManager,
    log
  );

  installInfoStatusBar(context);
}

/**
 * Persistent info block at the bottom of the VS Code window showing the
 * extension's name, installed version, and a clickable publisher link to
 * the GitHub repository. Reads metadata straight from package.json so the
 * block always reflects the running extension without any hardcoded copy.
 */
function installInfoStatusBar(context: ExtensionContext): void {
  const pkg = context.extension.packageJSON as {
    name?: string;
    displayName?: string;
    version?: string;
    publisher?: string;
    repository?: { url?: string } | string;
  };
  const repoUrl = normaliseRepoUrl(pkg.repository);
  if (!repoUrl) return;
  const openRepo = commands.registerCommand('composeTerminal.openRepo', async () => {
    await env.openExternal(Uri.parse(repoUrl));
  });
  const infoBar = new InfoStatusBar({
    name: pkg.displayName ?? pkg.name ?? 'Docker Terminal',
    version: pkg.version ?? '0.0.0',
    publisher: PUBLISHER_DISPLAY,
    repoUrl,
    openRepoCommand: 'composeTerminal.openRepo'
  });
  context.subscriptions.push(openRepo, infoBar);
}

function normaliseRepoUrl(repo: unknown): string | undefined {
  if (typeof repo === 'string') return repo.replace(/^git\+/, '').replace(/\.git$/, '');
  if (repo && typeof repo === 'object' && 'url' in repo && typeof repo.url === 'string') {
    return repo.url.replace(/^git\+/, '').replace(/\.git$/, '');
  }
  return undefined;
}

const PUBLISHER_DISPLAY = 'CodeMaster Soluções';

export function deactivate(): void {
  // disposables are released via context.subscriptions
}

interface OpenShellContext {
  docker: DockerClient;
  terminalManager: TerminalManager;
  project: ComposeProject;
  service: ComposeService;
  fileRef: ComposeFileRef;
}

async function pickComposeFile(files: ComposeFileRef[]): Promise<ComposeFileRef | undefined> {
  if (files.length === 1) return files[0];
  const items: QuickPickItem[] = files.map((f) => ({ label: f.label, description: f.path }));
  const picked = await window.showQuickPick(items, {
    placeHolder: 'Select docker-compose file'
  });
  if (!picked) return undefined;
  return files.find((f) => f.label === picked.label);
}

async function pickService(
  services: ComposeService[]
): Promise<ComposeService | undefined> {
  const items: QuickPickItem[] = services.map((s) => ({
    label: s.name,
    description: s.image,
    detail: s.workingDir ? `working_dir: ${s.workingDir}` : undefined
  }));
  const picked = await window.showQuickPick(items, {
    placeHolder: 'Select service to open shell into',
    matchOnDescription: true
  });
  if (!picked) return undefined;
  return services.find((s) => s.name === picked.label);
}

async function openShellForService(ctx: OpenShellContext): Promise<void> {
  const pattern =
    workspace
      .getConfiguration('composeTerminal')
      .get<string>('terminalName') ?? '{service} • {project}';
  const terminalName = pattern
    .replace('{service}', ctx.service.name)
    .replace('{project}', ctx.project.name);

  await window.withProgress(
    {
      location: ProgressLocation.Notification,
      title: `Docker Terminal: opening shell in ${ctx.service.name}…`,
      cancellable: false
    },
    async () => {
      const containerId = await ctx.docker.ensureRunning(ctx.fileRef.path, ctx.service.name);
      const shell = await detectDefaultShell(ctx.docker, containerId);
      ctx.terminalManager.open({
        name: terminalName,
        composeFilePath: ctx.fileRef.path,
        service: ctx.service.name,
        shell
      });
    }
  );
}

/**
 * Tolerant input normalizer: the command is invoked either from a TreeItem
 * (which passes the `ContainerInfo` we placed in `arguments`) or from the
 * command palette / a programmatic call. Accept either, refuse anything else.
 */
function normalizeContainerArg(arg: unknown): ContainerInfo | null {
  if (!arg || typeof arg !== 'object') return null;
  const obj = arg as Partial<ContainerInfo> & { info?: ContainerInfo };
  // Direct shape (from TreeItem.command.arguments).
  if (typeof obj.id === 'string' && typeof obj.name === 'string') {
    return validateContainer({ ...obj });
  }
  // Wrapped shape (defensive — future tree items may wrap the info).
  if (obj.info && typeof obj.info.id === 'string' && typeof obj.info.name === 'string') {
    return validateContainer({ ...obj.info });
  }
  return null;
}

function validateContainer(info: Partial<ContainerInfo>): ContainerInfo | null {
  if (!info.id || !info.name) return null;
  if (!isValidContainerId(info.id) && !isValidContainerName(info.id)) return null;
  if (!isValidContainerName(info.name)) return null;
  return {
    id: info.id,
    name: info.name,
    image: typeof info.image === 'string' ? info.image : '',
    status: typeof info.status === 'string' ? info.status : '',
    state: typeof info.state === 'string' ? info.state : ''
  };
}

async function attachToRunningContainer(
  docker: DockerClient,
  terminalManager: TerminalManager,
  info: ContainerInfo,
  log: OutputChannel
): Promise<void> {
  const pattern =
    workspace.getConfiguration('composeTerminal').get<string>('terminalName') ??
    '{service} • {project}';
  // No compose project here; substitute "docker" for {project} so the terminal
  // name still renders sensibly.
  const terminalName = pattern
    .replace('{service}', info.name)
    .replace('{project}', 'docker');

  await window.withProgress(
    {
      location: ProgressLocation.Notification,
      title: `Docker Terminal: opening shell in ${info.name}…`,
      cancellable: false
    },
    async () => {
      log.appendLine(`[info] attach: probing shell for ${info.id}`);
      const shell = await detectDefaultShell(docker, info.id);
      log.appendLine(`[info] attach: shell=${shell} — opening terminal "${terminalName}"`);
      try {
        terminalManager.openInContainer({
          name: terminalName,
          cwd: workspace.workspaceFolders?.[0]?.uri.fsPath,
          containerRef: info.id,
          shell
        });
        log.appendLine(`[info] attach: terminal created and sendText scheduled`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.appendLine(`[error] attach: openInContainer threw: ${message}`);
        log.appendLine(err instanceof Error && err.stack ? err.stack : '(no stack)');
        throw err;
      }
    }
  );
}

/**
 * Tolerant input normalizer for compose service commands.
 *
 * Accepts EITHER:
 *   1. A `ComposeServiceRef` plain object — passed via `TreeItem.command.arguments`
 *      when the user clicks the row label.
 *   2. A `ComposeTreeItem` instance — passed when the user clicks an inline
 *      action icon (VS Code forwards the element itself).
 *
 * Anything else returns null and the command refuses to fire.
 */
function normalizeServiceRef(arg: unknown): ComposeServiceRef | null {
  if (!arg || typeof arg !== 'object') return null;
  const obj = arg as Partial<ComposeServiceRef> & {
    kind?: unknown;
    fileRef?: { path?: unknown; label?: unknown };
    service?: { name?: unknown };
  };
  if (
    typeof obj.composeFilePath === 'string' &&
    typeof obj.serviceName === 'string' &&
    obj.composeFilePath &&
    obj.serviceName
  ) {
    return { composeFilePath: obj.composeFilePath, serviceName: obj.serviceName };
  }
  if (
    obj.kind === 'service' &&
    obj.fileRef &&
    typeof obj.fileRef.path === 'string' &&
    obj.service &&
    typeof obj.service.name === 'string'
  ) {
    return { composeFilePath: obj.fileRef.path, serviceName: obj.service.name };
  }
  return null;
}

async function runShellAction(
  docker: DockerClient,
  terminalManager: TerminalManager,
  ref: ComposeServiceRef
): Promise<void> {
  const project = await parseComposeFile(ref.composeFilePath);
  const service = project.services.find((s) => s.name === ref.serviceName);
  if (!service) {
    throw new Error(`Service "${ref.serviceName}" not found in ${ref.composeFilePath}.`);
  }
  await openShellForService({
    docker,
    terminalManager,
    project,
    service,
    fileRef: { label: project.name, path: ref.composeFilePath }
  });
}

interface LifecycleRefresher {
  refresh(): void;
}

async function runComposeLifecycle(
  docker: DockerClient,
  log: OutputChannel,
  ref: ComposeServiceRef,
  argv: string[],
  title: string,
  refreshers: LifecycleRefresher[]
): Promise<void> {
  await window.withProgress(
    {
      location: ProgressLocation.Notification,
      title: `Docker Terminal: ${title}`,
      cancellable: false
    },
    async () => {
      const result = await docker.runCompose(ref.composeFilePath, argv);
      if (result.code !== 0) {
        const message =
          (result.stderr || result.stdout || `exit ${result.code}`).trim().slice(0, 500) ||
          `exit ${result.code}`;
        log.appendLine(
          `[error] compose ${argv.join(' ')} ${ref.serviceName} failed (code ${result.code}): ${message}`
        );
        throw new Error(`docker compose ${argv.join(' ')} ${ref.serviceName} failed: ${message}`);
      }
      log.appendLine(`[info] compose ${argv.join(' ')} ${ref.serviceName} ok`);
      for (const r of refreshers) r.refresh();
    }
  );
}

function openComposeLogsTerminal(_docker: DockerClient, ref: ComposeServiceRef): void {
  // Open a dedicated terminal that tails the service logs interactively.
  // We shell out via the same `docker compose` invocation so v1/v2 fallback
  // and project name resolution stay consistent with the rest of the
  // extension. The user can Ctrl+C to stop tailing.
  // NOTE: `docker compose logs` (v2) does NOT accept `--details` — that flag
  // is for the standalone `docker logs` CLI. Compose prefixes each line
  // with its service name automatically, which is usually enough.
  const project = DockerClient.projectName(ref.composeFilePath);
  const cmd = `docker compose -p "${project}" -f "${ref.composeFilePath}" logs -f "${ref.serviceName}"`;
  const term = window.createTerminal({
    name: `logs • ${ref.serviceName}`,
    cwd: path.dirname(ref.composeFilePath)
  });
  term.show();
  term.sendText(cmd);
}

async function runContainerLifecycle(
  docker: DockerClient,
  log: OutputChannel,
  info: ContainerInfo,
  argv: string[],
  title: string,
  refreshers: LifecycleRefresher[]
): Promise<void> {
  await window.withProgress(
    {
      location: ProgressLocation.Notification,
      title: `Docker Terminal: ${title}`,
      cancellable: false
    },
    async () => {
      const result = await docker.runDocker(argv);
      if (result.code !== 0) {
        const message =
          (result.stderr || result.stdout || `exit ${result.code}`).trim().slice(0, 500) ||
          `exit ${result.code}`;
        log.appendLine(
          `[error] docker ${argv.join(' ')} ${info.id} failed (code ${result.code}): ${message}`
        );
        throw new Error(`docker ${argv.join(' ')} ${info.id} failed: ${message}`);
      }
      log.appendLine(`[info] docker ${argv.join(' ')} ${info.id} ok`);
      for (const r of refreshers) r.refresh();
    }
  );
}

function openContainerLogsTerminal(_docker: DockerClient, info: ContainerInfo): void {
  const dockerCmd =
    workspace.getConfiguration('composeTerminal').get<string>('dockerCommand') ?? 'docker';
  // `--details` prefixes each line with its source (stdout/stderr).
  const cmd = `${dockerCmd} logs -f --details "${info.id}"`;
  const term = window.createTerminal({
    name: `logs • ${info.name}`,
    cwd: workspace.workspaceFolders?.[0]?.uri.fsPath
  });
  term.show();
  term.sendText(cmd);
}

function invalidRefWarn(log: OutputChannel, name: string): void {
  log.appendLine(`[warn] ${name} invoked without a valid service ref`);
  void window.showErrorMessage(`Docker Terminal: ${name} invoked without a valid service ref.`);
}

function invalidContainerWarn(log: OutputChannel, name: string): void {
  log.appendLine(`[warn] ${name} invoked without a valid container ref`);
  void window.showErrorMessage(`Docker Terminal: ${name} invoked without a valid container ref.`);
}

function lifecycleError(log: OutputChannel, name: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  const truncated = message.length > 500 ? `${message.slice(0, 500)}…` : message;
  log.appendLine(`[error] ${name} failed: ${truncated}`);
  log.appendLine(err instanceof Error && err.stack ? err.stack : '(no stack)');
  void window.showErrorMessage(`Docker Terminal: ${truncated}`);
}
