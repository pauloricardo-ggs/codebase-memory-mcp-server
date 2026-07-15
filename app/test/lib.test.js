import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { assertSafeSegment, gitAuthEnvironment, indexRepositoryArguments, loadCredentials, parseLastJsonLine, safeChild, saveCredentials, slugify } from '../src/lib.js';

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

test('indexação usa flags em vez do JSON depreciado', () => {
  assert.deepEqual(indexRepositoryArguments('/data/repositories/time/api'), [
    'cli', 'index_repository', '--repo-path', '/data/repositories/time/api'
  ]);
});

test('extrai o projeto da última linha JSON da indexação', () => {
  assert.deepEqual(parseLastJsonLine('level=info msg=start\n{"project":"workspace-api","status":"indexed"}\n'), {
    project: 'workspace-api', status: 'indexed'
  });
});

test('credencial do GitHub persiste com permissão restrita', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'cbm-credentials-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'secrets', 'github-credentials.json');
  const credentials = { token: 'github_pat_example', user: { login: 'octocat' } };

  await saveCredentials(file, credentials);

  assert.deepEqual(await loadCredentials(file), credentials);
  if (process.platform !== 'win32') {
    assert.equal((await stat(path.dirname(file))).mode & 0o777, 0o700);
    assert.equal((await stat(file)).mode & 0o777, 0o600);
  }
});
