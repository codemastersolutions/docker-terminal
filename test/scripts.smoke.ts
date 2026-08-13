import * as assert from 'assert';

const MODULE_PATH = '../src/containers/scripts';

type ParseFn = (content: string, filePath: string) => Array<{
  name: string;
  command: string;
  source: 'package.json' | 'Makefile';
  filePath: string;
}>;

async function loadParsers(): Promise<{
  parsePackageJsonScripts: ParseFn;
  parseMakefileTargets: ParseFn;
}> {
  const mod = await import(MODULE_PATH) as {
    parsePackageJsonScripts: ParseFn;
    parseMakefileTargets: ParseFn;
  };
  return mod;
}

async function run(): Promise<void> {
  const { parsePackageJsonScripts, parseMakefileTargets } = await loadParsers();

  // ---- parsePackageJsonScripts ----
  const pkgSimple = JSON.stringify({
    name: 'my-app',
    version: '1.0.0',
    scripts: {
      start: 'node index.js',
      build: 'tsc -p tsconfig.json',
      test: 'jest --coverage',
      lint: 'eslint src/**/*.ts'
    }
  });
  const pkgEntries = parsePackageJsonScripts(pkgSimple, '/app/package.json');
  assert.strictEqual(pkgEntries.length, 4, 'package.json: 4 scripts parsed');
  assert.deepStrictEqual(
    pkgEntries.map((e) => e.name).sort(),
    ['build', 'lint', 'start', 'test'].sort()
  );
  const startEntry = pkgEntries.find((e) => e.name === 'start')!;
  assert.strictEqual(startEntry.command, 'node index.js');
  assert.strictEqual(startEntry.source, 'package.json');
  assert.strictEqual(startEntry.filePath, '/app/package.json');

  const emptyScripts = JSON.stringify({ scripts: {} });
  assert.strictEqual(
    parsePackageJsonScripts(emptyScripts, '/x/package.json').length,
    0,
    'package.json: empty scripts → none'
  );

  const noScripts = JSON.stringify({ name: 'x' });
  assert.strictEqual(
    parsePackageJsonScripts(noScripts, '/x/package.json').length,
    0,
    'package.json: no scripts key → none'
  );

  assert.strictEqual(
    parsePackageJsonScripts('not valid json', '/x/package.json').length,
    0,
    'package.json: invalid JSON → none'
  );

  const nullValue = JSON.stringify({ scripts: { foo: null, bar: 42, baz: 'ok' } });
  const nullEntries = parsePackageJsonScripts(nullValue, '/x/package.json');
  assert.strictEqual(nullEntries.length, 1, 'package.json: only string-valued scripts kept');
  assert.strictEqual(nullEntries[0].name, 'baz');
  assert.strictEqual(nullEntries[0].command, 'ok');

  // ---- parseMakefileTargets ----
  const makefileSimple = [
    '# A sample Makefile',
    '',
    '.PHONY: all build test clean',
    '',
    'all: build',
    '',
    'build: compile link',
    '\t@echo "Building..."',
    '',
    'compile:',
    '\tgcc -c main.c',
    '',
    'link:',
    '\tgcc -o app main.o',
    '',
    'test: build',
    '\t./app --test',
    '',
    'clean:',
    '\trm -f *.o app',
    '',
    'install-deps/install-something: dep1 dep2',
    '\t@echo installing',
    '',
    'include other.mk',
    '-include optional.mk',
    '',
    '# Target with percent (pattern rule) — should be included',
    '%.o: %.c',
    '\tgcc -c $<',
  ].join('\n');

  const makeEntries = parseMakefileTargets(makefileSimple, '/app/Makefile');
  const makeNames = makeEntries.map((e) => e.name);
  const expectedTargets = [
    'all',
    'build',
    'compile',
    'link',
    'test',
    'clean',
    'install-deps/install-something',
    '%.o'
  ];
  for (const t of expectedTargets) {
    assert.ok(
      makeNames.includes(t),
      `Makefile: expected target "${t}" in [${makeNames.join(', ')}]`
    );
  }
  for (const e of makeEntries) {
    assert.strictEqual(e.source, 'Makefile');
    assert.strictEqual(e.command, `make ${e.name}`);
    assert.strictEqual(e.filePath, '/app/Makefile');
  }

  const dotPhonyEntries = makeEntries.filter((e) => e.name.startsWith('.'));
  assert.strictEqual(
    dotPhonyEntries.length,
    0,
    'Makefile: dot-targets (like .PHONY) are excluded'
  );

  const emptyMakefile = '';
  assert.strictEqual(
    parseMakefileTargets(emptyMakefile, '/x/Makefile').length,
    0,
    'Makefile: empty → none'
  );

  const commentMakefile = ['# just comments', '# nothing here'].join('\n');
  assert.strictEqual(
    parseMakefileTargets(commentMakefile, '/x/Makefile').length,
    0,
    'Makefile: comments only → none'
  );

  const noColonMakefile = ['variable = value', 'ANOTHER=123'].join('\n');
  assert.strictEqual(
    parseMakefileTargets(noColonMakefile, '/x/Makefile').length,
    0,
    'Makefile: variable assignments → no targets extracted'
  );

  const indentedLinesMakefile = [
    'real-target:',
    '\tthis-is-indented-so-not-a-target:',
    '  another-indented: should be skipped',
    'legit: dep'
  ].join('\n');
  const indentedEntries = parseMakefileTargets(indentedLinesMakefile, '/x/Makefile');
  const indentedNames = indentedEntries.map((e) => e.name);
  assert.deepStrictEqual(indentedNames.sort(), ['legit', 'real-target'].sort());

  // Dedupe: same target appearing twice → only one entry
  const dedupeMakefile = ['foo: a', 'foo: b'].join('\n');
  const dedupeEntries = parseMakefileTargets(dedupeMakefile, '/x/Makefile');
  assert.strictEqual(dedupeEntries.length, 1, 'Makefile: duplicate targets deduped');
  assert.strictEqual(dedupeEntries[0].name, 'foo');

  // eslint-disable-next-line no-console
  console.log(
    `OK — container scripts parser: ` +
      `${pkgEntries.length} package.json entries; ` +
      `${makeEntries.length} Makefile targets; ` +
      `edge cases (empty, invalid, dedupe, indentation, dot-targets) all covered`
  );
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
