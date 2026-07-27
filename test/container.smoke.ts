import { parseContainerList } from '../src/docker/client';
import { isValidContainerId, isValidContainerName } from '../src/compose/validation';
import * as assert from 'assert';

// ---- isValidContainerId ----
const validIds = [
  'a',
  '0',
  'ab',
  'deadbeef',
  '0123456789abcdef',
  'a'.repeat(64) // full SHA-256
];
for (const id of validIds) {
  assert.ok(isValidContainerId(id), `expected "${id}" to be a valid container id`);
}

const invalidIds: unknown[] = [
  '',
  'ABCDEF', // uppercase hex rejected (Docker ids are lowercase)
  'g', // non-hex
  'a b', // space
  'a;rm',
  'a$(whoami)',
  'a`x`',
  'a"b',
  "a'b",
  'a\\x',
  'a/b',
  'a'.repeat(65), // too long
  null,
  undefined,
  42,
  {},
  []
];
for (const id of invalidIds) {
  assert.ok(!isValidContainerId(id), `expected ${JSON.stringify(id)} to be rejected as container id`);
}

// ---- isValidContainerName ----
const validNames = [
  'web',
  'web1',
  'my_app',
  'my-app',
  'my.app',
  'A',
  '0a',
  'a'.repeat(64)
];
for (const name of validNames) {
  assert.ok(isValidContainerName(name), `expected "${name}" to be a valid container name`);
}

const invalidNames: unknown[] = [
  '',
  '-leading-dash',
  '_leading-underscore',
  '.leading-dot',
  'has space',
  'has/slash',
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
  'a'.repeat(65),
  null,
  undefined,
  123,
  {},
  []
];
for (const name of invalidNames) {
  assert.ok(!isValidContainerName(name), `expected ${JSON.stringify(name)} to be rejected as container name`);
}

// ---- parseContainerList ----
const sampleOutput = [
  // Two well-formed lines
  'a1b2c3d4e5f6\tweb\tnginx:1.27\tUp 5 minutes',
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef\tdb\tpostgres:16\tUp 2 hours'
].join('\n');
let parsed = parseContainerList(sampleOutput);
assert.strictEqual(parsed.length, 2, 'two valid lines parsed');
assert.strictEqual(parsed[0].id, 'a1b2c3d4e5f6');
assert.strictEqual(parsed[0].name, 'web');
assert.strictEqual(parsed[0].image, 'nginx:1.27');
assert.strictEqual(parsed[0].status, 'Up 5 minutes');
assert.strictEqual(parsed[1].id, '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef');
assert.strictEqual(parsed[1].name, 'db');

// Whitespace tolerance and CR/LF endings
parsed = parseContainerList('  a1b2c3d4e5f6\tweb\tnginx:1.27\tUp 5 minutes  \r\n');
assert.strictEqual(parsed.length, 1, 'whitespace + CRLF tolerated');
assert.strictEqual(parsed[0].name, 'web');

// Empty input and only-blank lines
assert.strictEqual(parseContainerList('').length, 0, 'empty → none');
assert.strictEqual(parseContainerList('\n\n  \n').length, 0, 'blank lines only → none');

// Malformed: only one tab-separated field → skipped
assert.strictEqual(parseContainerList('not-a-ps-line').length, 0, 'bare word ignored');
// Malformed: invalid id (uppercase) → skipped
assert.strictEqual(parseContainerList('DEADBEEF\tweb\tnginx\tUp').length, 0, 'bad hex id rejected');
// Malformed: invalid name (starts with dash) → skipped
assert.strictEqual(parseContainerList('a1b2c3\t-bad\tnginx\tUp').length, 0, 'bad name rejected');

// Image names with embedded whitespace are not produced by Docker, but if
// something exotic sneaks in we should preserve it rather than crash.
const exotic = parseContainerList('a1b2c3d4\tapp\tmy image:latest\tUp 1m');
assert.strictEqual(exotic.length, 1);
assert.strictEqual(exotic[0].image, 'my image:latest');

// eslint-disable-next-line no-console
console.log(
  `OK — container validation: ${validIds.length} ids + ${validNames.length} names accepted; ` +
    `${invalidIds.length} ids + ${invalidNames.length} names rejected; parseContainerList covers well-formed, whitespace, empty, malformed inputs`
);
