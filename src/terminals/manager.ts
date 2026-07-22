import * as path from 'path';
import { Disposable, Terminal, window, workspace } from 'vscode';
import { isValidServiceName, isValidShellPath } from '../compose/validation';
import { getHostClearCommand } from '../host/clearCommand';

export interface OpenShellOptions {
  name: string;
  composeFilePath: string;
  service: string;
  shell: string;
}

export class TerminalManager implements Disposable {
  private readonly terminals = new Map<string, Terminal>();

  open(opts: OpenShellOptions): Terminal {
    const key = `${opts.composeFilePath}::${opts.service}`;

    const existing = this.terminals.get(key);
    if (existing && this.isAlive(existing)) {
      existing.show();
      return existing;
    }

    // Defense-in-depth: by the time we reach here, the service name came from
    // a parsed compose file that already filtered invalid names, and the shell
    // path came from a verified `/etc/passwd` probe. Re-validate so that this
    // method is safe to call from anywhere — nothing shell-unsafe can ever
    // reach terminal.sendText.
    if (!isValidServiceName(opts.service)) {
      throw new Error(`Invalid service name: ${truncate(opts.service)}`);
    }
    if (!isValidShellPath(opts.shell)) {
      throw new Error(`Invalid shell path: ${truncate(opts.shell)}`);
    }

    const config = workspace.getConfiguration('composeTerminal');
    const dockerCommand = config.get<string>('dockerCommand') ?? 'docker';
    const clearOnExit = config.get<boolean>('clearOnExit') ?? true;
    const cwd = path.dirname(opts.composeFilePath);

    const terminal = window.createTerminal({
      name: opts.name,
      cwd
    });

    // Service and shell are both restricted to [a-zA-Z0-9/._+-], so the
    // double quotes around them are sufficient — no further escaping needed.
    // The bracketing clear commands run in the VS Code terminal's shell (not
    // the container): the leading one wipes host noise before the exec
    // attaches, and the trailing one wipes the buffer once the user exits.
    // Both are gated by `clearOnExit` and selected by host OS — `clear` on
    // POSIX, `cls` on Windows.
    const clearCmd = clearOnExit ? getHostClearCommand() : null;
    const execCommand = `${dockerCommand} compose exec -it "${opts.service}" "${opts.shell}"`;
    const fullCommand = clearCmd
      ? `${clearCmd} && ${execCommand} && ${clearCmd}`
      : execCommand;
    terminal.sendText(fullCommand);
    terminal.show();

    this.terminals.set(key, terminal);

    return terminal;
  }

  private isAlive(terminal: Terminal): boolean {
    return window.terminals.includes(terminal);
  }

  dispose(): void {
    for (const terminal of this.terminals.values()) {
      terminal.dispose();
    }
    this.terminals.clear();
  }
}

function truncate(s: string, max = 64): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}