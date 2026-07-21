import {
  commands,
  ExtensionContext,
  ProgressLocation,
  QuickPickItem,
  window,
  workspace
} from 'vscode';
import { findComposeFiles, parseComposeFile } from './compose/parser';
import type { ComposeFileRef, ComposeProject, ComposeService } from './compose/types';
import { DockerClient } from './docker/client';
import { detectDefaultShell } from './docker/shell';
import { TerminalManager } from './terminals/manager';

export async function activate(context: ExtensionContext): Promise<void> {
  const config = workspace.getConfiguration('composeTerminal');
  const docker = new DockerClient({
    dockerCommand: config.get<string>('dockerCommand') ?? 'docker',
    preferComposeV2: config.get<boolean>('preferComposeV2') ?? true
  });
  const terminalManager = new TerminalManager();

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
      void window.showErrorMessage(`Docker Terminal: ${truncated}`);
    }
  });

  context.subscriptions.push(openShell, terminalManager);
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