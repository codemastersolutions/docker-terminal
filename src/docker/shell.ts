import type { DockerClient } from './client';
import { isValidShellPath } from '../compose/validation';

/**
 * Detect the default login shell of the user running inside the container.
 *
 * Strategy (tried in order):
 *   1. `getent passwd $(id -u) | cut -d: -f7`   — canonical Linux source
 *   2. `grep "^$(id -u):" /etc/passwd | cut -d: -f7` — musl/Alpine fallback
 *   3. `echo $SHELL`                            — last resort env hint
 *
 * All probes require a working `/bin/sh`. If even that is missing (true
 * distroless images), we throw an actionable error instead of guessing.
 */
export async function detectDefaultShell(
  client: DockerClient,
  containerId: string
): Promise<string> {
  const probes: Array<{ label: string; cmd: string[] }> = [
    {
      label: 'getent passwd',
      cmd: ['sh', '-c', 'getent passwd "$(id -u)" | cut -d: -f7']
    },
    {
      label: 'grep /etc/passwd',
      cmd: ['sh', '-c', 'grep "^$(id -u):" /etc/passwd | cut -d: -f7']
    },
    {
      label: '$SHELL',
      cmd: ['sh', '-c', 'echo "$SHELL"']
    }
  ];

  const errors: string[] = [];

  for (const probe of probes) {
    try {
      const result = await client.execInContainer(containerId, probe.cmd);
      if (result.code === 0) {
        const shell = result.stdout.trim();
        if (shell) {
          if (!isValidShellPath(shell)) {
            errors.push(`${probe.label}: returned non-conforming path`);
            continue;
          }
          const verified = await verifyShell(client, containerId, shell);
          if (verified) return verified;
          errors.push(`${probe.label}: returned "${shell}" but binary is not executable`);
          continue;
        }
        errors.push(`${probe.label}: empty output`);
      } else {
        errors.push(`${probe.label}: exit ${result.code}`);
      }
    } catch (err) {
      errors.push(`${probe.label}: ${(err as Error).message}`);
    }
  }

  throw new Error(
    `Could not determine a usable shell inside the container. ` +
      `Probes attempted:\n  - ${errors.join('\n  - ')}\n` +
      `This usually means the image is distroless or has no /bin/sh — open shell manually with \`docker exec\`.`
  );
}

async function verifyShell(
  client: DockerClient,
  containerId: string,
  shell: string
): Promise<string | null> {
  // Belt-and-suspenders: the caller already validated, but reject again so
  // this function is safe to call independently. Because `shell` is restricted
  // to [a-zA-Z0-9/._+-], no further quoting is needed.
  if (!isValidShellPath(shell)) return null;
  try {
    const result = await client.execInContainer(containerId, [
      'sh',
      '-c',
      `test -x "${shell}" && echo ok`
    ]);
    if (result.code === 0 && result.stdout.trim() === 'ok') return shell;
  } catch {
    // verification failed
  }
  return null;
}