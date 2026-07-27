import { spawn } from 'child_process';
import * as path from 'path';
import { sanitizeProjectName } from '../compose/parser';
import { isValidContainerId, isValidContainerName } from '../compose/validation';

export interface ContainerInfo {
  id: string;
  name: string;
  image: string;
  status: string;
  /**
   * Docker state string: `running`, `exited`, `paused`, `restarting`,
   * `dead`, `created`. Lower-cased and trimmed. Used by the tree view to
   * decide which lifecycle icons (`Start` / `Stop` / `Restart` / `Logs`)
   * should be enabled.
   */
  state: string;
}

const MAX_ERROR_CHARS = 500;

/**
 * Trim error output so a stray long line (e.g. compose dumping a 50KB env-var
 * traceback) does not flood the VS Code modal or accidentally surface
 * secrets. The caller sees the head of the message and an ellipsis.
 */
function trimError(s: string): string {
  const t = s.trim();
  if (t.length <= MAX_ERROR_CHARS) return t;
  return `${t.slice(0, MAX_ERROR_CHARS)}…`;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  code: number;
}

export interface ComposeInvocation {
  cmd: string;
  prefix: string[];
}

export interface DockerClientOptions {
  dockerCommand?: string;
  preferComposeV2?: boolean;
}

export class DockerClient {
  private readonly dockerCommand: string;
  private readonly preferComposeV2: boolean;
  private resolved: ComposeInvocation | null = null;

  constructor(opts: DockerClientOptions = {}) {
    this.dockerCommand = opts.dockerCommand ?? 'docker';
    this.preferComposeV2 = opts.preferComposeV2 ?? true;
  }

  static projectName(composeFilePath: string): string {
    return sanitizeProjectName(path.basename(path.dirname(composeFilePath)));
  }

  private execCapture(
    cmd: string,
    args: string[],
    spawnOpts: { cwd?: string } = {}
  ): Promise<ExecResult> {
    return new Promise((resolve, reject) => {
      const proc = spawn(cmd, args, {
        cwd: spawnOpts.cwd,
        env: process.env
      });
      let stdout = '';
      let stderr = '';
      proc.stdout.on('data', (d) => {
        stdout += d.toString();
      });
      proc.stderr.on('data', (d) => {
        stderr += d.toString();
      });
      proc.on('error', (err) => reject(err));
      proc.on('close', (code) => resolve({ stdout, stderr, code: code ?? -1 }));
    });
  }

  private async composeInvocation(): Promise<ComposeInvocation> {
    if (this.resolved) return this.resolved;

    if (this.preferComposeV2) {
      try {
        await this.execCapture(this.dockerCommand, ['compose', 'version']);
        this.resolved = { cmd: this.dockerCommand, prefix: ['compose'] };
        return this.resolved;
      } catch {
        // fall through to v1
      }
    }

    try {
      await this.execCapture('docker-compose', ['version']);
      this.resolved = { cmd: 'docker-compose', prefix: [] };
      return this.resolved;
    } catch {
      throw new Error(
        'Neither "docker compose" (v2) nor "docker-compose" (v1) is available in PATH.'
      );
    }
  }

  /**
   * Pure: build the full argv for a `docker compose ...` invocation.
   * Global flags (-p, -f) precede the subcommand, per Docker Compose spec.
   */
  static buildArgv(
    invocation: ComposeInvocation,
    composeFilePath: string,
    subcommandArgs: string[]
  ): string[] {
    const project = DockerClient.projectName(composeFilePath);
    return [
      ...invocation.prefix,
      '-p',
      project,
      '-f',
      composeFilePath,
      ...subcommandArgs
    ];
  }

  async runCompose(
    composeFilePath: string,
    extra: string[]
  ): Promise<ExecResult> {
    const inv = await this.composeInvocation();
    const cwd = path.dirname(composeFilePath);
    const args = DockerClient.buildArgv(inv, composeFilePath, extra);
    return this.execCapture(inv.cmd, args, { cwd });
  }

  async execInContainer(
    containerId: string,
    args: string[]
  ): Promise<ExecResult> {
    if (!isValidContainerId(containerId) && !isValidContainerName(containerId)) {
      throw new Error(
        `execInContainer: refusing non-conforming container ref "${trimError(containerId)}"`
      );
    }
    return this.execCapture(this.dockerCommand, ['exec', containerId, ...args]);
  }

  /**
   * Run a top-level `docker <args...>` invocation (no `exec` subcommand).
   * Used by container lifecycle commands (`stop`, `restart`, `start`) and by
   * the logs tail opener. Validates the container ref first so an attacker
   * can't smuggle CLI flags through a malicious sidebar argument.
   */
  async runDocker(args: string[]): Promise<ExecResult> {
    return this.execCapture(this.dockerCommand, args);
  }

  /**
   * List every container on the host — running AND stopped (`docker ps -a`).
   * The Containers sidebar uses the per-row `.State` column to decide which
   * lifecycle icons (`Start` / `Stop` / `Restart` / `Logs`) are enabled.
   */
  async listContainers(): Promise<ContainerInfo[]> {
    const result = await this.execCapture(this.dockerCommand, [
      'ps',
      '-a',
      '--no-trunc',
      '--format',
      '{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.State}}'
    ]);
    if (result.code !== 0) {
      throw new Error(
        `docker ps failed: ${trimError(result.stderr) || trimError(result.stdout) || `exit ${result.code}`}`
      );
    }
    return parseContainerList(result.stdout);
  }

  /**
   * Query running state for every service in a compose project.
   *
   * Runs `docker compose ps -a` once per compose file and returns a
   * `serviceName → state` map. Services absent from the map have no container
   * (never started or fully removed) — the tree view treats them as stopped.
   *
   * Failures (compose CLI missing, project broken) degrade to an empty map so
   * the sidebar still renders — items just show the `*Stopped` contextValue
   * and only `Start` is enabled.
   */
  async composeServiceStates(
    composeFilePath: string
  ): Promise<Map<string, string>> {
    let result;
    try {
      result = await this.runCompose(composeFilePath, [
        'ps',
        '-a',
        '--format',
        '{{.Service}}\t{{.State}}'
      ]);
    } catch (err) {
      // composeInvocation itself can throw if neither v1 nor v2 is on PATH.
      // Degrade silently — the view will mark every service as stopped.
      this.composeStatesLastError =
        err instanceof Error ? err.message : String(err);
      return new Map();
    }
    this.composeStatesLastError = null;
    const map = new Map<string, string>();
    if (result.code !== 0) {
      // Project has no containers yet, or ps returned nothing useful. Empty
      // map = everything looks stopped, which is the right UX for a project
      // that has never been `up`'d.
      return map;
    }
    for (const line of result.stdout.split('\n')) {
      const trimmed = line.replace(/\r$/, '').trim();
      if (!trimmed) continue;
      const [service, state] = trimmed.split('\t');
      if (service && state) {
        map.set(service.trim(), state.trim().toLowerCase());
      }
    }
    return map;
  }

  /** Diagnostic surfaced via logs when `composeServiceStates` swallows an error. */
  private composeStatesLastError: string | null = null;
  get composeStatesError(): string | null {
    return this.composeStatesLastError;
  }

  /**
   * Ensure a service has a running container. If none is running, start it.
   * Returns the running container id.
   */
  async ensureRunning(composeFilePath: string, service: string): Promise<string> {
    const ps = await this.runCompose(composeFilePath, [
      'ps',
      service,
      '--format',
      '{{.ID}}\t{{.State}}'
    ]);
    if (ps.code !== 0) {
      throw new Error(
        `compose ps failed: ${trimError(ps.stderr) || trimError(ps.stdout) || `exit ${ps.code}`}`
      );
    }
    const running = this.parseRunningId(ps.stdout);
    if (running) return running;

    const up = await this.runCompose(composeFilePath, ['up', '-d', service]);
    if (up.code !== 0) {
      throw new Error(
        `Failed to start service "${service}": ${trimError(up.stderr) || `exit ${up.code}`}`
      );
    }

    const ps2 = await this.runCompose(composeFilePath, [
      'ps',
      service,
      '--format',
      '{{.ID}}\t{{.State}}'
    ]);
    const runningAfter = this.parseRunningId(ps2.stdout);
    if (runningAfter) return runningAfter;

    throw new Error(
      `Service "${service}" did not report a running container after start.`
    );
  }

  private parseRunningId(output: string): null | string {
    for (const line of output.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const [id, state] = trimmed.split('\t');
      if (id && state && state.trim().toLowerCase() === 'running') {
        return id.trim();
      }
    }
    return null;
  }
}

/**
 * Pure: parse the tab-separated `docker ps -a --format` output into
 * `ContainerInfo[]`. The format string is:
 *
 *   `{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.State}}`
 *
 * Fields with embedded tabs (extremely rare in image names) get folded back
 * together so we don't lose data. The last two columns are reserved for
 * `.Status` and `.State`; image = everything in between.
 *
 * The first tab-separated column is the daemon-supplied id (always lowercase
 * hex per Docker spec), so we require `isValidContainerId` strictly — a
 * name-shaped first column would mean the parser is reading garbage, not a
 * container list.
 */
export function parseContainerList(output: string): ContainerInfo[] {
  const out: ContainerInfo[] = [];
  for (const rawLine of output.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split('\t');
    if (parts.length < 2) continue;
    const [id, name] = parts;
    const trimmedId = id.trim();
    if (!isValidContainerId(trimmedId)) continue;
    const trimmedName = name.trim();
    if (!isValidContainerName(trimmedName)) continue;
    const state = parts.length >= 5 ? parts[parts.length - 1].trim() : '';
    const status =
      parts.length >= 4 ? parts[parts.length - 2].trim() : '';
    const image =
      parts.length >= 5
        ? parts.slice(2, -2).join('\t').trim()
        : '';
    out.push({
      id: trimmedId,
      name: trimmedName,
      image,
      status,
      state: state.toLowerCase()
    });
  }
  return out;
}