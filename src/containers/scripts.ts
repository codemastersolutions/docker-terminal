import * as path from "path";
import type { DockerClient } from "../docker/client";
import {
  isValidContainerId,
  isValidContainerName,
} from "../compose/validation";

export interface ScriptEntry {
  name: string;
  command: string;
  source: "package.json" | "Makefile";
  filePath: string;
}

const COMMON_WORKDIRS = [
  "/app",
  "/usr/src/app",
  "/workspace",
  "/project",
  "/home/node/app",
  "/home/node",
  "/srv/app",
  "/var/www",
  "/var/www/html",
  "/opt/app",
  "/code",
  "/src",
];

const EXCLUDED_DIRS = [
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".nuxt",
  ".output",
  ".cache",
  ".turbo",
  "coverage",
  ".venv",
  "venv",
  "__pycache__",
  "vendor",
  ".sass-cache",
];

const FILE_CHECK_BATCH = [
  {
    file: "package.json",
    source: "package.json" as const,
    parser: parsePackageJsonScripts,
  },
  {
    file: "Makefile",
    source: "Makefile" as const,
    parser: parseMakefileTargets,
  },
];

const FIND_MAX_DEPTH = 4;

export function isInsideHiddenDir(filePath: string): boolean {
  const parts = filePath.split("/").filter(Boolean);
  parts.pop();
  return parts.some((segment) => segment.startsWith("."));
}

export async function discoverScripts(
  docker: DockerClient,
  containerRef: string,
): Promise<ScriptEntry[]> {
  if (
    !isValidContainerId(containerRef) &&
    !isValidContainerName(containerRef)
  ) {
    return [];
  }

  const workdirs = await discoverWorkdirs(docker, containerRef);
  const allFiles: { filePath: string; source: "package.json" | "Makefile" }[] =
    [];
  const checked = new Set<string>();

  for (const dir of workdirs) {
    const found = await findScriptFilesInDir(docker, containerRef, dir);
    for (const f of found) {
      const normalized = f.filePath.replace(/\/+/g, "/");
      if (isInsideHiddenDir(normalized)) continue;
      if (checked.has(normalized)) continue;
      checked.add(normalized);
      allFiles.push(f);
    }
  }

  const all: ScriptEntry[] = [];
  for (const { filePath, source } of allFiles) {
    try {
      const content = await readFileInContainer(docker, containerRef, filePath);
      if (content === null) continue;
      const parser = FILE_CHECK_BATCH.find((f) => f.source === source)?.parser;
      if (!parser) continue;
      const entries = parser(content, filePath);
      all.push(...entries);
    } catch {}
  }

  const seen = new Map<string, ScriptEntry>();
  for (const entry of all) {
    const key = `${entry.source}:${entry.name}:${entry.filePath}`;
    if (!seen.has(key)) seen.set(key, entry);
  }
  return Array.from(seen.values());
}

async function findScriptFilesInDir(
  docker: DockerClient,
  containerRef: string,
  baseDir: string,
): Promise<{ filePath: string; source: "package.json" | "Makefile" }[]> {
  const results: { filePath: string; source: "package.json" | "Makefile" }[] =
    [];
  const cleanDir = baseDir.replace(/\/+$/, "") || "/";

  const excludedExpr = EXCLUDED_DIRS.map((d) => `-name ${d}`).join(" -o ");
  const findCmd = [
    "find",
    `"${cleanDir}"`,
    `-maxdepth ${FIND_MAX_DEPTH}`,
    `\\( -type d \\( -name ".*" -o ${excludedExpr} \\) \\) -prune -o`,
    `-type f`,
    `\\( -name "package.json" -o -name "Makefile" \\)`,
    "-print 2>/dev/null",
  ].join(" ");

  try {
    const result = await docker.execInContainer(containerRef, [
      "sh",
      "-c",
      findCmd,
    ]);
    if (result.code !== 0) return [];
    const lines = result.stdout
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);

    for (const line of lines) {
      const normalized = line.replace(/\/+/g, "/");
      const basename = path.posix.basename(normalized);
      if (basename === "package.json") {
        results.push({ filePath: normalized, source: "package.json" });
      } else if (basename === "Makefile") {
        results.push({ filePath: normalized, source: "Makefile" });
      }
    }
  } catch {}

  return results;
}

async function discoverWorkdirs(
  docker: DockerClient,
  containerRef: string,
): Promise<string[]> {
  const dirs: string[] = [];
  const added = new Set<string>();

  const push = (d: string) => {
    const clean = d.replace(/\/+$/, "") || "/";
    if (!added.has(clean)) {
      added.add(clean);
      dirs.push(clean);
    }
  };

  try {
    const result = await docker.execInContainer(containerRef, [
      "sh",
      "-c",
      "pwd",
    ]);
    if (result.code === 0 && result.stdout.trim()) {
      push(result.stdout.trim());
    }
  } catch {}

  try {
    const result = await docker.execInContainer(containerRef, [
      "sh",
      "-c",
      'echo "$PWD"',
    ]);
    if (result.code === 0 && result.stdout.trim()) {
      push(result.stdout.trim());
    }
  } catch {}

  for (const d of COMMON_WORKDIRS) push(d);
  push("/");

  return dirs;
}

async function readFileInContainer(
  docker: DockerClient,
  containerRef: string,
  filePath: string,
): Promise<string | null> {
  try {
    const result = await docker.execInContainer(containerRef, [
      "sh",
      "-c",
      `cat "${filePath}" 2>/dev/null || echo __DT_FILE_NOT_FOUND__`,
    ]);
    if (result.code !== 0) return null;
    const out = result.stdout;
    if (out.trim() === "__DT_FILE_NOT_FOUND__") return null;
    return out;
  } catch {
    return null;
  }
}

export function parsePackageJsonScripts(
  content: string,
  filePath: string,
): ScriptEntry[] {
  try {
    const parsed = JSON.parse(content);
    if (!parsed || typeof parsed !== "object") return [];
    const scripts = (parsed as { scripts?: Record<string, string> }).scripts;
    if (!scripts || typeof scripts !== "object") return [];
    const entries: ScriptEntry[] = [];
    for (const [name, command] of Object.entries(scripts)) {
      if (typeof name === "string" && typeof command === "string") {
        entries.push({
          name,
          command,
          source: "package.json",
          filePath,
        });
      }
    }
    return entries;
  } catch {
    return [];
  }
}

export function parseMakefileTargets(
  content: string,
  filePath: string,
): ScriptEntry[] {
  const entries: ScriptEntry[] = [];
  const seen = new Set<string>();
  const lines = content.split(/\r?\n/);

  for (const raw of lines) {
    const line = raw.replace(/\s+#.*$/, "").trimEnd();
    if (!line) continue;
    if (/^\s/.test(raw)) continue;
    if (line.startsWith(".")) continue;
    if (!line.includes(":")) continue;
    if (/^\s*include\s/.test(line)) continue;
    if (/^\s*[-?]?include\s/.test(line)) continue;

    const colonIdx = line.indexOf(":");
    const left = line.slice(0, colonIdx).trim();
    if (!left) continue;
    if (!/^[A-Za-z0-9_./%-][A-Za-z0-9_./%-]*$/.test(left)) continue;

    const targets = left.split(/\s+/).filter(Boolean);
    for (const target of targets) {
      if (seen.has(target)) continue;
      seen.add(target);
      entries.push({
        name: target,
        command: `make ${target}`,
        source: "Makefile",
        filePath,
      });
    }
  }
  return entries;
}

export function getParentFolderName(filePath: string): {
  folderPath: string;
  folderName: string;
} {
  const dir = path.posix.dirname(filePath);
  const name = dir === "/" ? "/" : path.posix.basename(dir);
  return { folderPath: dir, folderName: name };
}
