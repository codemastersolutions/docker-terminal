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
  const checked = new Set<string>();
  const all: ScriptEntry[] = [];

  for (const dir of workdirs) {
    for (const check of FILE_CHECK_BATCH) {
      const fullPath = dir === "/" ? `/${check.file}` : `${dir}/${check.file}`;
      const normalized = fullPath.replace(/\/+/g, "/");
      if (checked.has(normalized)) continue;
      checked.add(normalized);

      try {
        const content = await readFileInContainer(
          docker,
          containerRef,
          normalized,
        );
        if (content === null) continue;
        const entries = check.parser(content, normalized);
        all.push(...entries);
      } catch {}
    }
  }

  const seen = new Map<string, ScriptEntry>();
  for (const entry of all) {
    const key = `${entry.source}:${entry.name}:${entry.filePath}`;
    if (!seen.has(key)) seen.set(key, entry);
  }
  return Array.from(seen.values());
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
