import { DockerClient } from '../src/docker/client';
import * as assert from 'assert';

const fixture = `${__dirname}/fixtures/docker-compose.yml`;

// Simulate `docker compose` invocation (v2)
const composeV2 = { cmd: 'docker', prefix: ['compose'] };
// Simulate `docker-compose` invocation (v1)
const composeV1 = { cmd: 'docker-compose', prefix: [] };

function run(): void {
  // v2: `docker compose -p fixtures -f <path> ps web --format '{{.ID}}\t{{.State}}'`
  const v2Args = DockerClient.buildArgv(composeV2, fixture, [
    'ps',
    'web',
    '--format',
    '{{.ID}}\t{{.State}}'
  ]);
  assert.deepStrictEqual(v2Args, [
    'compose',
    '-p',
    'fixtures',
    '-f',
    fixture,
    'ps',
    'web',
    '--format',
    '{{.ID}}\t{{.State}}'
  ], 'v2 argv puts global flags before subcommand');

  // v1: `docker-compose -p fixtures -f <path> up -d web`
  const v1Args = DockerClient.buildArgv(composeV1, fixture, ['up', '-d', 'web']);
  assert.deepStrictEqual(v1Args, [
    '-p',
    'fixtures',
    '-f',
    fixture,
    'up',
    '-d',
    'web'
  ], 'v1 argv puts global flags before subcommand');

  // Regression guard: -p must NOT appear after `ps`
  for (const argv of [v2Args, v1Args]) {
    const psIdx = argv.indexOf('ps');
    const pIdx = argv.indexOf('-p');
    assert.ok(
      psIdx === -1 || pIdx < psIdx,
      `-p (idx ${pIdx}) must precede subcommand 'ps' (idx ${psIdx})`
    );
  }

  // eslint-disable-next-line no-console
  console.log('OK — argv ordering correct for both v1 and v2 invocations');
}

run();