import { DockerClient } from '../src/docker/client';
import * as path from 'path';

const fixture = path.resolve(`${__dirname}/fixtures/docker-compose.yml`);

/**
 * Probe whether `docker compose` (v2) or `docker-compose` (v1) is reachable.
 * Integration tests need a live Docker CLI; when it's missing (e.g. on a
 * developer machine without Docker, or in a lightweight pre-commit hook),
 * we SKIP instead of FAIL — `npm test` still passes so the developer
 * workflow isn't blocked.
 */
async function dockerComposeAvailable(): Promise<boolean> {
  try {
    const probe = await new DockerClient().runCompose(fixture, [
      'version',
      '--short'
    ]);
    return probe.code === 0;
  } catch {
    return false;
  }
}

async function run(): Promise<void> {
  if (!(await dockerComposeAvailable())) {
    // eslint-disable-next-line no-console
    console.log(
      'SKIP — docker compose not available in PATH; integration test requires Docker CLI.'
    );
    return;
  }

  const client = new DockerClient();

  // `docker compose -p fixtures -f <fixture> config -q` is a safe read-only call.
  // It validates that the compose file parses and that global flags are accepted.
  const result = await client.runCompose(fixture, ['config', '-q']);

  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);

  if (result.code !== 0) {
    // eslint-disable-next-line no-console
    console.error(`FAIL: 'docker compose config' exited with code ${result.code}`);
    process.exit(1);
  }

  // eslint-disable-next-line no-console
  console.log('OK — docker compose accepted the argv order (-p and -f before subcommand)');
}

run().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('FAIL:', err.message);
  process.exit(1);
});