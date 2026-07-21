import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from 'js-yaml';
import type { WorkspaceFolder } from 'vscode';
import type { ComposeFileRef, ComposeProject } from './types';
import { isValidServiceName } from './validation';

const COMPOSE_FILENAMES = [
  'docker-compose.yml',
  'docker-compose.yaml',
  'compose.yml',
  'compose.yaml'
] as const;

const MAX_COMPOSE_FILE_BYTES = 1024 * 1024; // 1 MB — large enough for any realistic compose file

/**
 * Sanitize a project name per Docker Compose v2 rules:
 * lowercase, [a-z0-9_-] only, must start with a letter or digit.
 * Falls back to "default" if the result would be empty.
 */
export function sanitizeProjectName(raw: string): string {
  const cleaned = raw.toLowerCase().replace(/[^a-z0-9_-]/g, '');
  const valid = cleaned.replace(/^[^a-z0-9]+/, '').replace(/[^a-z0-9]+$/, '');
  return valid || 'default';
}

export async function findComposeFiles(
  folders: readonly WorkspaceFolder[] | undefined,
  explicit: readonly string[] = []
): Promise<ComposeFileRef[]> {
  const found: ComposeFileRef[] = [];

  for (const explicitPath of explicit) {
    try {
      const stat = await fs.stat(explicitPath);
      if (stat.isFile()) {
        const label = explicitPath.split('/').slice(-2).join('/');
        found.push({ label, path: explicitPath });
      }
    } catch {
      // skip missing/unreadable
    }
  }

  if (!folders) return found;

  for (const folder of folders) {
    for (const filename of COMPOSE_FILENAMES) {
      const candidate = path.join(folder.uri.fsPath, filename);
      try {
        const stat = await fs.stat(candidate);
        if (stat.isFile()) {
          found.push({
            label: `${folder.name}/${filename}`,
            path: candidate
          });
        }
      } catch {
        // not present
      }
    }
  }

  return found;
}

export async function parseComposeFile(filePath: string): Promise<ComposeProject> {
  const stat = await fs.stat(filePath);
  if (stat.size > MAX_COMPOSE_FILE_BYTES) {
    throw new Error(
      `${filePath} is too large (${stat.size} bytes; max ${MAX_COMPOSE_FILE_BYTES}).`
    );
  }
  const content = await fs.readFile(filePath, 'utf8');
  // Pin to JSON_SCHEMA for defense in depth: even though js-yaml@4's default
  // is already safe, an explicit schema prevents silent regressions if the
  // library's default changes.
  const doc = yaml.load(content, { schema: yaml.JSON_SCHEMA });

  if (!doc || typeof doc !== 'object') {
    throw new Error(`${filePath} is empty or invalid YAML.`);
  }

  const root = doc as Record<string, unknown>;
  const services = (root.services ?? {}) as Record<string, unknown>;

  const serviceEntries = Object.entries(services)
    .filter(([name]) => isValidServiceName(name))
    .map(([name, def]) => {
      const defObj = (def ?? {}) as Record<string, unknown>;
      return {
        name,
        image: typeof defObj.image === 'string' ? defObj.image : undefined,
        workingDir:
          typeof defObj.working_dir === 'string' ? defObj.working_dir : undefined
      };
    });

  const declaredName = typeof root.name === 'string' ? root.name : undefined;
  const fallbackName = path.basename(path.dirname(filePath));
  const projectName = sanitizeProjectName(declaredName ?? fallbackName);

  return {
    name: projectName,
    services: serviceEntries,
    composeFilePath: filePath
  };
}