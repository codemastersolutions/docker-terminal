import {
  commands,
  ExtensionContext,
  OutputChannel,
  ProgressLocation,
  QuickPickItem,
  window,
  workspace
} from 'vscode';
import { findComposeFiles, parseComposeFile } from './compose/parser';
import type { ComposeFileRef, ComposeProject, ComposeService } from './compose/types';
import { isValidContainerId, isValidContainerName } from './compose/validation';
import { ContainerTreeProvider } from './containers/provider';
import { ContainerInfo, DockerClient } from './docker/client';
import { detectDefaultShell } from './docker/shell';
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

  context.subscriptions.push(openShell, refreshContainers, attachContainer, terminalManager, log);
}

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
    status: typeof info.status === 'string' ? info.status : ''
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
