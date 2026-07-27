import * as path from 'path';
import { Disposable, OutputChannel, Terminal, window, workspace } from 'vscode';
import {
  isValidContainerId,
  isValidContainerName,
  isValidServiceName,
  isValidShellPath
} from '../compose/validation';
import { getHostClearCommand } from '../host/clearCommand';

export interface OpenShellOptions {
  name: string;
  composeFilePath: string;
  service: string;
  shell: string;
}

export interface OpenContainerShellOptions {
  name: string;
  cwd?: string;
  /**
   * Either a full container id (matched by `isValidContainerId`) or a
   * container name (matched by `isValidContainerName`). Same `docker exec`
   * semantics either way — the daemon resolves it.
   */
  containerRef: string;
  shell: string;
}

export class TerminalManager implements Disposable {
  private readonly terminals = new Map<string, Terminal>();

  constructor(private readonly log: OutputChannel) {}

  open(opts: OpenShellOptions): Terminal {
    const key = `compose::${opts.composeFilePath}::${opts.service}`;

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

    const terminal = window.createTerminal({
      name: opts.name,
      cwd: path.dirname(opts.composeFilePath)
    });

    terminal.show();

    // Service and shell are both restricted to [a-zA-Z0-9/._+-], so the
    // double quotes around them are sufficient — no further escaping needed.
    const execCommand = `${this.dockerCommand()} compose exec -it "${opts.service}" "${opts.shell}"`;
    this.log.appendLine(`[info] open(compose): service=${opts.service} shell=${opts.shell} cmd=${execCommand}`);
    this.scheduleSendText(terminal, execCommand);

    this.terminals.set(key, terminal);

    return terminal;
  }

  // VS Code's Terminal PTY isn't ready immediately after `createTerminal` —
  // calling `sendText` before the shell process spawns queues the input but
  // the shell never flushes it until the user clicks, scrolls, or otherwise
  // interacts with the terminal panel (the text just sits on the prompt).
  // We chain off `terminal.processId` — a Thenable that resolves once the
  // host shell process is alive — and add a short post-resolve buffer so the
  // shell has time to print its prompt before the command lands. A static
  // setTimeout (the previous approach) was unreliable: 250 ms is well under
  // real shell-startup latency on some hosts, and over it on others.
  private static readonly PROMPT_READY_DELAY_MS = 150;
  private static readonly PROCESS_WAIT_FALLBACK_MS = 500;

  /**
   * Open a shell in an arbitrary running container by id or name (no docker
   * compose involved). Caller is responsible for shell detection.
   */
  openInContainer(opts: OpenContainerShellOptions): Terminal {
    if (!isValidContainerId(opts.containerRef) && !isValidContainerName(opts.containerRef)) {
      throw new Error(`Invalid container ref: ${truncate(opts.containerRef)}`);
    }
    if (!isValidShellPath(opts.shell)) {
      throw new Error(`Invalid shell path: ${truncate(opts.shell)}`);
    }

    const key = `container::${opts.containerRef}`;
    const existing = this.terminals.get(key);
    if (existing && this.isAlive(existing)) {
      existing.show();
      return existing;
    }

    const terminal = window.createTerminal({
      name: opts.name,
      cwd: opts.cwd
    });

    terminal.show();

    const execCommand = `${this.dockerCommand()} exec -it "${opts.containerRef}" "${opts.shell}"`;
    this.log.appendLine(
      `[info] openInContainer: ref=${opts.containerRef} shell=${opts.shell} cmd=${execCommand}`
    );
    this.scheduleSendText(terminal, execCommand);

    this.terminals.set(key, terminal);

    return terminal;
  }

  private dockerCommand(): string {
    return workspace.getConfiguration('composeTerminal').get<string>('dockerCommand') ?? 'docker';
  }

  /**
   * Read `clearOnExit` once and produce the full command string. The bracketing
   * clear commands run in the VS Code terminal's shell (not the container):
   * the leading one wipes host noise before the exec attaches, and the
   * trailing one wipes the buffer once the user exits. Selected by host OS —
   * `clear` on POSIX, `cls` on Windows.
   */
  private buildCommand(execCommand: string): string {
    const clearOnExit =
      workspace.getConfiguration('composeTerminal').get<boolean>('clearOnExit') ?? true;
    if (!clearOnExit) return execCommand;
    return `${getHostClearCommand()} && ${execCommand} && ${getHostClearCommand()}`;
  }

  private scheduleSendText(terminal: Terminal, execCommand: string): void {
    const full = this.buildCommand(execCommand);

    const send = () => {
      // Guard against disposal between scheduling and firing (e.g. the user
      // closed the panel before the timer ran). `sendText` on a disposed
      // terminal throws, which would surface as an unhandled rejection.
      if (!window.terminals.includes(terminal)) {
        this.log.appendLine(`[warn] sendText skipped: terminal no longer alive`);
        return;
      }
      try {
        terminal.sendText(full);
        this.log.appendLine(`[info] sendText delivered: ${full}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.log.appendLine(`[error] sendText threw: ${message}`);
      }
    };

    // Chain off `processId` so we never deliver `sendText` to a PTY whose
    // shell hasn't spawned yet. If the promise rejects (very rare — usually
    // only on a hard shell-start failure) fall back to a fixed delay so the
    // user still gets a working terminal in the common case.
    try {
      const pidPromise = terminal.processId;
      if (!pidPromise) {
        this.log.appendLine(`[warn] processId unavailable (undefined) — using fallback delay`);
        setTimeout(send, TerminalManager.PROCESS_WAIT_FALLBACK_MS);
        return;
      }
      pidPromise.then(
        (pid) => {
          this.log.appendLine(`[info] processId resolved: ${pid} — scheduling sendText in ${TerminalManager.PROMPT_READY_DELAY_MS}ms`);
          setTimeout(send, TerminalManager.PROMPT_READY_DELAY_MS);
        },
        (err) => {
          this.log.appendLine(`[warn] processId rejected: ${err instanceof Error ? err.message : String(err)} — using fallback delay`);
          setTimeout(send, TerminalManager.PROCESS_WAIT_FALLBACK_MS);
        }
      );
    } catch (err) {
      this.log.appendLine(`[warn] processId access threw: ${err instanceof Error ? err.message : String(err)} — using fallback delay`);
      setTimeout(send, TerminalManager.PROCESS_WAIT_FALLBACK_MS);
    }
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
