import { isValidServiceName, isValidShellPath } from '../src/compose/validation';
import * as assert from 'assert';

// Matches compose-spec service name regex: ^[a-z0-9][a-z0-9_-]*$
const validServices = [
  'web',
  'api',
  'db',
  'web1',
  '1web',
  'a',
  'z',
  '0',
  'under_first',
  'has-dash',
  'has_under',
  'foo-bar-baz',
  '3rd-party-service',
  'a'.repeat(63)
];
for (const s of validServices) {
  assert.ok(isValidServiceName(s), `expected "${s}" to be a valid service name`);
}

const invalidServices: unknown[] = [
  '',
  '-leading-dash',
  '_leading-underscore',
  'Has-Caps',
  'WEB',
  'has.dot',
  'has space',
  'has/slash',
  'has\\backslash',
  'has;semicolon',
  'has$dollar',
  'has`backtick',
  'has"quote',
  "has'quote",
  'has|pipe',
  'has&amp',
  'has(paren',
  'has)close',
  'has<lt',
  'has>gt',
  '$(rm -rf /)',
  'a$(whoami)b',
  'a`whoami`b',
  null,
  undefined,
  123,
  {},
  []
];
for (const s of invalidServices) {
  assert.ok(!isValidServiceName(s), `expected ${JSON.stringify(s)} to be rejected as service name`);
}

// Shell paths: absolute, no shell metacharacters
const validShells = [
  '/bin/sh',
  '/bin/bash',
  '/bin/zsh',
  '/bin/ash',
  '/bin/dash',
  '/bin/busybox',
  '/usr/bin/fish',
  '/usr/local/bin/bash',
  '/opt/shells/custom-shell',
  '/bin/bash-5.2'
];
for (const s of validShells) {
  assert.ok(isValidShellPath(s), `expected "${s}" to be a valid shell path`);
}

const invalidShells: unknown[] = [
  '',
  'bash',
  './bash',
  '../bash',
  '/bin/../sh',
  '/bin/sh;rm',
  '/bin/$(id)',
  '`/bin/sh`',
  '/bin/sh"',
  "/bin/sh'",
  '/bin/sh\\x',
  '/bin/sh|cat',
  '/bin/sh&',
  '/bin sh',
  null,
  undefined,
  42,
  {}
];
for (const s of invalidShells) {
  assert.ok(!isValidShellPath(s), `expected ${JSON.stringify(s)} to be rejected as shell path`);
}

// eslint-disable-next-line no-console
console.log(
  `OK — validation: ${validServices.length} services accepted, ${invalidServices.length} rejected, ` +
    `${validShells.length} shells accepted, ${invalidShells.length} rejected`
);