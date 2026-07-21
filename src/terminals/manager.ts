import * as path from 'path';
import { Disposable, Terminal, window, workspace } from 'vscode';
import { isValidServiceName, isValidShellPath } from '../compose/validation';

export interface OpenShellOptions {
  name: string;
  composeFilePath: string;
  service: string;
  shell: string;
}

const CLEAR_SEQUENCE = '\x1b[H\x1b[2J\x1b[3J';

export class TerminalManager implements Disposable {
  private readonly terminals = new Map<string, Terminal>();
  private readonly clearTimers = new Map<string, NodeJS.Timeout>();

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
    const clearAfterMs = config.get<number>('clearTerminalAfterMs') ?? 1500;
    const cwd = path.dirname(opts.composeFilePath);

    const terminal = window.createTerminal({
      name: opts.name,
      cwd
    });

    // Service and shell are both restricted to [a-zA-Z0-9/._+-], so the
    // double quotes around them are sufficient — no further escaping needed.
    terminal.sendText(`${dockerCommand} compose exec -it "${opts.service}" "${opts.shell}"`);
    terminal.show();

    this.terminals.set(key, terminal);

    // Schedule a clear-screen ANSI sequence. It is sent through docker exec
    // into the container's PTY, which interprets it and clears the visible
    // scrollback — removing the message, echoed host command, host prompt,
    // and the blank gap before the container prompt.
    if (clearAfterMs > 0) {
      const timer = setTimeout(() => {
        this.clearTimers.delete(key);
        if (this.isAlive(terminal)) {
          terminal.sendText(CLEAR_SEQUENCE, false);
        }
      }, clearAfterMs);
      this.clearTimers.set(key, timer);
    }

    return terminal;
  }

  private isAlive(terminal: Terminal): boolean {
    return window.terminals.includes(terminal);
  }

  dispose(): void {
    for (const timer of this.clearTimers.values()) {
      clearTimeout(timer);
    }
    this.clearTimers.clear();
    for (const terminal of this.terminals.values()) {
      terminal.dispose();
    }
    this.terminals.clear();
  }
}

function truncate(s: string, max = 64): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}