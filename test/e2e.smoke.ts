import { DockerClient } from '../src/docker/client';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

/**
 * Probe whether the Docker daemon is reachable (not just the CLI). E2E tests
 * spin up real containers; if the daemon isn't running, we SKIP — keeping
 * `npm test` green on developer machines and pre-commit hooks without
 * blocking the developer workflow.
 */
async function dockerDaemonAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const { spawn } = require('child_process') as typeof import('child_process');
    const proc = spawn('docker', ['version', '--format', '{{.Server.Version}}'], {
      stdio: ['ignore', 'pipe', 'ignore']
    });
    let stdout = '';
    proc.stdout.on('data', (d) => {
      stdout += d.toString();
    });
    proc.on('error', () => resolve(false));
    proc.on('close', (code) => resolve(code === 0 && stdout.trim().length > 0));
  });
}

async function run(): Promise<void> {
  if (!(await dockerDaemonAvailable())) {
    // eslint-disable-next-line no-console
    console.log(
      'SKIP — Docker daemon not reachable; E2E test requires a running dockerd.'
    );
    return;
  }

  // Create a throwaway compose project with a real runnable image
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'docker-terminal-e2e-'));
  const composeFile = path.join(tmpDir, 'docker-compose.yml');

  await fs.writeFile(
    composeFile,
    [
      'name: e2e',
      'services:',
      '  web:',
      '    image: alpine:3.20',
      '    command: ["sleep", "3600"]',
      ''
    ].join('\n')
  );

  const client = new DockerClient();
  let createdContainerId: string | null = null;

  try {
    // STEP 1: ensureRunning on a STOPPED container
    // eslint-disable-next-line no-console
    console.log('STEP 1: ensureRunning on stopped container…');
    const idFromStopped = await client.ensureRunning(composeFile, 'web');
    createdContainerId = idFromStopped;
    // eslint-disable-next-line no-console
    console.log('  → got id:', idFromStopped);

    // STEP 2: ensureRunning on the same RUNNING container (idempotency check)
    // eslint-disable-next-line no-console
    console.log('STEP 2: ensureRunning on running container…');
    const idFromRunning = await client.ensureRunning(composeFile, 'web');
    if (idFromRunning !== idFromStopped) {
      throw new Error(
        `ensureRunning returned different id on second call: ${idFromRunning} vs ${idFromStopped}`
      );
    }
    // eslint-disable-next-line no-console
    console.log('  → same id:', idFromRunning);

    // STEP 3: execInContainer — the exact call detectDefaultShell makes
    // eslint-disable-next-line no-console
    console.log('STEP 3: execInContainer (getent probe)…');
    const probe1 = await client.execInContainer(idFromRunning, [
      'sh',
      '-c',
      'getent passwd "$(id -u)" | cut -d: -f7'
    ]);
    // eslint-disable-next-line no-console
    console.log('  → code:', probe1.code, '| stdout:', JSON.stringify(probe1.stdout), '| stderr:', JSON.stringify(probe1.stderr));
    if (probe1.code !== 0) {
      throw new Error(`probe1 failed: ${probe1.stderr}`);
    }
    const expectedShell = probe1.stdout.trim();
    if (!expectedShell.startsWith('/')) {
      throw new Error(`probe1 returned non-absolute shell: ${expectedShell}`);
    }
    // eslint-disable-next-line no-console
    console.log('  → expected shell:', expectedShell);

    // eslint-disable-next-line no-console
    console.log('OK — full flow works on a real container');
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('FAIL:', (err as Error).message);
    process.exitCode = 1;
  } finally {
    // Cleanup
    try {
      if (createdContainerId) {
        await client.execInContainer(createdContainerId, ['true']);
      }
    } catch {
      // ignore
    }
    try {
      // Use docker compose down -v with the temp project
      const down = await client.runCompose(composeFile, ['down', '-v', '--remove-orphans']);
      if (down.code !== 0) {
        process.stderr.write(`cleanup compose down: ${down.stderr}\n`);
      }
    } catch (e) {
      process.stderr.write(`cleanup error: ${(e as Error).message}\n`);
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

run();