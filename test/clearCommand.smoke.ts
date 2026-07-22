import { getHostClearCommand } from '../src/host/clearCommand';
import * as assert from 'assert';

const cases: Array<{ platform: NodeJS.Platform; expected: string }> = [
  { platform: 'linux', expected: 'clear' },
  { platform: 'darwin', expected: 'clear' },
  { platform: 'freebsd', expected: 'clear' },
  { platform: 'openbsd', expected: 'clear' },
  { platform: 'sunos', expected: 'clear' },
  { platform: 'win32', expected: 'cls' }
];

for (const c of cases) {
  const got = getHostClearCommand(c.platform);
  assert.strictEqual(
    got,
    c.expected,
    `getHostClearCommand(${c.platform}) → ${JSON.stringify(got)}, expected ${JSON.stringify(c.expected)}`
  );
}

// Default (no argument) must match the actual host platform — ensures we don't
// regress the wiring by hardcoding the wrong branch.
const def = getHostClearCommand();
assert.ok(def === 'clear' || def === 'cls', `default returned ${JSON.stringify(def)}, expected 'clear' or 'cls'`);
assert.strictEqual(def, getHostClearCommand(process.platform), 'default must equal process.platform result');

// eslint-disable-next-line no-console
console.log(
  `OK — host clear command: ${cases.length} platforms mapped, default resolves to ${JSON.stringify(def)} on this host`
);
