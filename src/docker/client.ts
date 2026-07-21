import { spawn } from 'child_process';
import * as path from 'path';
import { sanitizeProjectName } from '../compose/parser';

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
    return this.execCapture(this.dockerCommand, ['exec', containerId, ...args]);
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