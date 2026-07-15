import test from 'node:test';
import assert from 'node:assert/strict';
import { assertSafeSegment, gitAuthEnvironment, safeChild, slugify } from '../src/lib.js';

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

test('autenticação Git usa Basic sem expor o token no argumento do clone', () => {
  const environment = gitAuthEnvironment('github_pat_example');
  assert.equal(environment.GIT_CONFIG_KEY_0, 'http.https://github.com/.extraheader');
  assert.equal(environment.GIT_TERMINAL_PROMPT, '0');
  const encoded = environment.GIT_CONFIG_VALUE_0.replace('Authorization: Basic ', '');
  assert.equal(Buffer.from(encoded, 'base64').toString('utf8'), 'x-access-token:github_pat_example');
});
