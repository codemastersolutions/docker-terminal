import { parseComposeFile } from '../src/compose/parser';
import * as assert from 'assert';

const fixture = `${__dirname}/fixtures/docker-compose.yml`;

async function run(): Promise<void> {
  const project = await parseComposeFile(fixture);

  assert.strictEqual(project.name, 'fixture-project', 'project name from compose "name:" field');
  assert.strictEqual(project.services.length, 3, 'three services parsed');

  const web = project.services.find((s) => s.name === 'web');
  assert.ok(web, 'web service present');
  assert.strictEqual(web!.image, 'nginx:1.27-alpine');
  assert.strictEqual(web!.workingDir, '/usr/share/nginx/html');

  const api = project.services.find((s) => s.name === 'api');
  assert.ok(api);
  assert.strictEqual(api!.workingDir, '/app');

  const db = project.services.find((s) => s.name === 'db');
  assert.ok(db);
  assert.strictEqual(db!.workingDir, undefined, 'db has no working_dir');

  // eslint-disable-next-line no-console
  console.log('OK — parsed', project.services.length, 'services from', fixture);
}

run().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('FAIL:', err);
  process.exit(1);
});