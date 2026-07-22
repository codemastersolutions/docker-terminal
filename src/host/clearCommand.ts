/**
 * Host-shell cleanup command per operating system.
 *
 * The VS Code integrated terminal inherits the user's default shell, which
 * differs across platforms:
 *   - POSIX (Linux, macOS, BSD): `clear` is universally available and clears
 *     the screen through terminfo.
 *   - Windows (cmd, PowerShell): `cls` is the canonical screen-clear command.
 *
 * `clear` is not a built-in on Windows, so we map `win32` → `cls` and every
 * other platform → `clear`. The returned string is a plain command word so
 * callers can append it with `&&` to an existing shell invocation.
 */
export function getHostClearCommand(platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32' ? 'cls' : 'clear';
}
