import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { assertSafeSegment, generateMcpToken, gitAuthEnvironment, indexRepositoryArguments, loadCredentials, loadMcpUserStore, loadSecret, mcpTokenFingerprint, parseLastJsonLine, publicMcpUser, removeMcpGatewayUserKey, safeChild, saveCredentials, saveMcpUserStore, saveSecret, setMcpGatewayUserKey, slugify } from '../src/lib.js';

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

test('gera tokens MCP fortes e uma fingerprint estável', () => {
  const first = generateMcpToken();
  const second = generateMcpToken();
  assert.match(first, /^cbm_mcp_[A-Za-z0-9_-]{43}$/);
  assert.notEqual(first, second);
  assert.equal(mcpTokenFingerprint(first).length, 64);
  assert.equal(mcpTokenFingerprint(first), mcpTokenFingerprint(first));
});

test('gerencia somente as chaves MCP pertencentes ao painel', () => {
  const config = {
    mcp: {
      port: 8787,
      policies: {
        cors: { allowOrigins: ['*'] },
        apiKey: { mode: 'optional', keys: [{ key: 'manual-key', metadata: { owner: 'manual' } }] }
      }
    }
  };
  const user = { id: 'user-1', name: 'Maria', identity: 'maria@empresa.com' };

  setMcpGatewayUserKey(config, user, 'first-token');
  setMcpGatewayUserKey(config, user, 'rotated-token');

  assert.equal(config.mcp.policies.apiKey.mode, 'strict');
  assert.deepEqual(config.mcp.policies.cors, { allowOrigins: ['*'] });
  assert.deepEqual(config.mcp.policies.apiKey.keys.map(item => item.key), ['manual-key', 'rotated-token']);

  removeMcpGatewayUserKey(config, user.id);
  assert.deepEqual(config.mcp.policies.apiKey.keys.map(item => item.key), ['manual-key']);
  assert.equal(config.mcp.policies.apiKey.mode, 'strict');
});

test('mantém strict com zero chaves depois da última revogação', () => {
  const config = { mcp: { policies: {} } };
  removeMcpGatewayUserKey(config, 'missing-user');
  assert.deepEqual(config.mcp.policies.apiKey, { keys: [], mode: 'strict' });
});

test('cadastro MCP persiste protegido sem expor o hash na API', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'cbm-mcp-users-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'secrets', 'mcp-users.json');
  const user = { id: 'user-1', name: 'Maria', tokenHash: 'secret-hash', status: 'active' };
  const store = { managed: true, users: [user] };

  await saveMcpUserStore(file, store);

  assert.deepEqual(await loadMcpUserStore(file), store);
  assert.deepEqual(publicMcpUser(user), { id: 'user-1', name: 'Maria', status: 'active' });
  if (process.platform !== 'win32') {
    assert.equal((await stat(path.dirname(file))).mode & 0o777, 0o700);
    assert.equal((await stat(file)).mode & 0o777, 0o600);
  }
});

test('token técnico persiste em arquivo protegido', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'cbm-mcp-system-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'secrets', 'mcp-system-token');
  const token = generateMcpToken();

  await saveSecret(file, token);

  assert.equal(await loadSecret(file), token);
  if (process.platform !== 'win32') assert.equal((await stat(file)).mode & 0o777, 0o600);
});
