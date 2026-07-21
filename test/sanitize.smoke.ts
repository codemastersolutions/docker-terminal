import { sanitizeProjectName } from '../src/compose/parser';
import * as assert from 'assert';

const cases: Array<{ input: string; expected: string }> = [
  { input: 'fixture-project', expected: 'fixture-project' },
  { input: 'Fixture Project', expected: 'fixtureproject' },
  { input: 'Meu Projeto!', expected: 'meuprojeto' },
  { input: 'docker-terminal-e2e-I7TyW9', expected: 'docker-terminal-e2e-i7tyw9' },
  { input: '---leading-and-trailing---', expected: 'leading-and-trailing' },
  { input: '_-_-', expected: 'default' },
  { input: '', expected: 'default' },
  { input: '123-numbers-ok', expected: '123-numbers-ok' },
  { input: 'with spaces and  symbols', expected: 'withspacesandsymbols' }
];

for (const c of cases) {
  const got = sanitizeProjectName(c.input);
  assert.strictEqual(got, c.expected, `sanitize(${JSON.stringify(c.input)}) → ${JSON.stringify(got)}, expected ${JSON.stringify(c.expected)}`);
}

// eslint-disable-next-line no-console
console.log(`OK — sanitizeProjectName handles ${cases.length} cases (spaces, case, symbols, edges)`);