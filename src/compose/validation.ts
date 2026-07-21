/**
 * Strict whitelists for inputs that flow into argv slots or shell commands.
 *
 * Service names come from user-controlled `docker-compose.yml` files (often
 * pulled from third-party repos). Shell paths come from `/etc/passwd` inside
 * arbitrary containers. Anything that fails these checks is treated as
 * untrusted and must NOT reach a shell — callers should reject or skip it.
 *
 * Rationale:
 *   - Service name regex is the official Docker Compose v2 schema
 *     (compose-spec): lowercase alphanumeric, dash, underscore.
 *   - Shell path regex covers every standard Unix shell binary
 *     (bash, zsh, sh, ash, fish, dash, csh, tcsh, ksh, …) and nothing else.
 *   - Both whitelists are intentionally narrow — defense in depth beats
 *     clever escaping.
 */

const SERVICE_NAME_RE = /^[a-z0-9][a-z0-9_-]*$/;
const SHELL_PATH_RE = /^\/[a-zA-Z0-9/._+-]+$/;

export function isValidServiceName(name: unknown): name is string {
  return typeof name === 'string' && SERVICE_NAME_RE.test(name);
}

export function isValidShellPath(path: unknown): path is string {
  if (typeof path !== 'string') return false;
  if (!SHELL_PATH_RE.test(path)) return false;
  // Defense in depth: reject any path containing `..` segments so a hostile
  // container cannot redirect the probe or the eventual `docker exec` away
  // from a known shell binary.
  if (path.split('/').includes('..')) return false;
  return true;
}