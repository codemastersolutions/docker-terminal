import * as assert from 'assert';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { findComposeFiles, parseComposeFile } from '../src/compose/parser';
import type { ComposeFileRef } from '../src/compose/types';

async function run(): Promise<void> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codeterm-compose-tree-'));
  try {
    const composePath = path.join(root, 'docker-compose.yml');
    const yaml = [
      'name: smoke-project',
      'services:',
      '  web:',
      '    image: nginx:1.27-alpine',
      '    working_dir: /usr/share/nginx/html',
      '  api:',
      '    image: node:20-bookworm-slim',
      '    working_dir: /app',
      '  db:',
      '    image: postgres:16-alpine',
      ''
    ].join('\n');
    await fs.writeFile(composePath, yaml, 'utf8');

    const folder = {
      uri: { fsPath: root, scheme: 'file', path: root } as never,
      name: 'tmp',
      index: 0
    } as never;

    const files: ComposeFileRef[] = await findComposeFiles([folder], []);
    assert.strictEqual(files.length, 1, 'one compose file discovered');
    assert.strictEqual(files[0].path, composePath, 'compose file path matches');

    const project = await parseComposeFile(files[0].path);
    assert.strictEqual(project.name, 'smoke-project', 'project name from compose');
    assert.strictEqual(project.services.length, 3, 'three services parsed');
    assert.strictEqual(project.composeFilePath, composePath, 'compose file path on project');

    // Verify the project shape that the tree provider consumes.
    const web = project.services.find((s) => s.name === 'web');
    assert.ok(web, 'web service present');
    assert.strictEqual(web!.image, 'nginx:1.27-alpine', 'web image parsed');
    assert.strictEqual(web!.workingDir, '/usr/share/nginx/html', 'web working_dir parsed');

    // eslint-disable-next-line no-console
    console.log('OK — compose tree smoke:', project.services.length, 'services from', composePath);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

run().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('FAIL:', err);
  process.exit(1);
});