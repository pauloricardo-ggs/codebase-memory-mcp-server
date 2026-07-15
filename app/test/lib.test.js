import test from 'node:test';
import assert from 'node:assert/strict';
import { assertSafeSegment, safeChild, slugify } from '../src/lib.js';

test('slugify normaliza nomes de workspaces', () => {
  assert.equal(slugify('Pagamentos & Cobrança'), 'pagamentos-cobranca');
});

test('safeChild mantém caminhos dentro da raiz', () => {
  assert.equal(safeChild('/repos', 'time', 'api'), '/repos/time/api');
  assert.throws(() => safeChild('/repos', '..', 'etc'), /fora da raiz/);
});

test('identificadores recusam path traversal', () => {
  assert.throws(() => assertSafeSegment('../etc'));
  assert.equal(assertSafeSegment('meu-workspace'), 'meu-workspace');
});
