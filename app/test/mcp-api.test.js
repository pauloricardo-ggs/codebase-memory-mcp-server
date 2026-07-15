import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

function listen(server, port = 0) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server.address().port));
  });
}

function close(server) {
  return new Promise(resolve => server.close(resolve));
}

async function availablePort() {
  const server = http.createServer();
  const port = await listen(server);
  await close(server);
  return port;
}

async function waitFor(url) {
  let lastError;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch (error) { lastError = error; }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw lastError || new Error(`Servidor não ficou disponível: ${url}`);
}

async function request(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { 'content-type': 'application/json', ...options.headers }
  });
  const payload = await response.json();
  assert.equal(response.ok, true, JSON.stringify(payload));
  return payload;
}

test('API cria, revoga, reativa e exclui usuários no AgentGateway', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'cbm-mcp-api-'));
  t.after(() => rm(directory, { recursive: true, force: true }));

  let gatewayConfig = {
    config: { adminAddr: '0.0.0.0:15000' },
    mcp: {
      port: 8787,
      policies: { cors: { allowOrigins: ['*'] } },
      targets: [{ name: 'codebase-memory', stdio: { cmd: '/bin/example' } }]
    }
  };
  const gateway = http.createServer(async (req, res) => {
    if (req.url !== '/api/config') { res.writeHead(404).end(); return; }
    if (req.method === 'POST') {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      gatewayConfig = JSON.parse(raw);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"status":"success"}');
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(gatewayConfig));
  });
  const gatewayPort = await listen(gateway);
  t.after(() => close(gateway));

  const appPort = await availablePort();
  const app = spawn(process.execPath, ['src/server.js'], {
    cwd: path.resolve(import.meta.dirname, '..'),
    env: {
      ...process.env,
      PORT: String(appPort),
      UI_PORT: '8787',
      AGENTGATEWAY_UI_PORT: '8788',
      APP_DATA_DIR: path.join(directory, 'data'),
      CBM_ALLOWED_ROOT: path.join(directory, 'repositories'),
      AGENTGATEWAY_ADMIN_URL: `http://127.0.0.1:${gatewayPort}`
    },
    stdio: ['ignore', 'ignore', 'pipe']
  });
  let stderr = '';
  app.stderr.on('data', chunk => { stderr += chunk; });
  t.after(async () => {
    if (app.exitCode === null) {
      app.kill('SIGTERM');
      await once(app, 'exit');
    }
  });
  await waitFor(`http://127.0.0.1:${appPort}/api/health`);

  assert.equal(gatewayConfig.mcp.policies.apiKey.mode, 'strict');
  assert.equal(gatewayConfig.mcp.policies.apiKey.keys.length, 1);
  assert.equal(gatewayConfig.mcp.policies.apiKey.keys[0].metadata.userId, 'system-playground');
  const system = await request(`http://127.0.0.1:${appPort}/api/mcp-system-token/reveal`, { method: 'POST' });
  assert.equal(system.token, gatewayConfig.mcp.policies.apiKey.keys[0].key);

  const created = await request(`http://127.0.0.1:${appPort}/api/mcp-users`, {
    method: 'POST',
    body: JSON.stringify({ name: 'Maria Silva', identity: 'maria@empresa.com', description: 'Plataforma' })
  });
  assert.match(created.token, /^cbm_mcp_/);
  assert.equal(gatewayConfig.mcp.policies.apiKey.mode, 'strict');
  const createdKey = gatewayConfig.mcp.policies.apiKey.keys.find(item => item.metadata.userId === created.user.id);
  assert.equal(createdKey.key, created.token);
  assert.deepEqual(gatewayConfig.mcp.policies.cors, { allowOrigins: ['*'] });

  const listed = await request(`http://127.0.0.1:${appPort}/api/mcp-users`);
  assert.equal(listed.accessMode, 'strict');
  assert.equal(listed.users.length, 1);
  assert.equal('tokenHash' in listed.users[0], false);
  assert.equal(JSON.stringify(listed).includes(created.token), false);

  await request(`http://127.0.0.1:${appPort}/api/mcp-users/${created.user.id}/revoke`, { method: 'POST' });
  assert.deepEqual(gatewayConfig.mcp.policies.apiKey.keys.map(item => item.metadata.userId), ['system-playground']);
  assert.equal(gatewayConfig.mcp.policies.apiKey.mode, 'strict');

  const reactivated = await request(`http://127.0.0.1:${appPort}/api/mcp-users/${created.user.id}/reactivate`, { method: 'POST' });
  assert.notEqual(reactivated.token, created.token);
  assert.equal(gatewayConfig.mcp.policies.apiKey.keys.find(item => item.metadata.userId === created.user.id).key, reactivated.token);

  await request(`http://127.0.0.1:${appPort}/api/mcp-users/${created.user.id}`, { method: 'DELETE' });
  assert.deepEqual(gatewayConfig.mcp.policies.apiKey.keys.map(item => item.metadata.userId), ['system-playground']);
  assert.equal(gatewayConfig.mcp.policies.apiKey.mode, 'strict');
  const rotatedSystem = await request(`http://127.0.0.1:${appPort}/api/mcp-system-token/rotate`, { method: 'POST' });
  assert.notEqual(rotatedSystem.token, system.token);
  assert.equal(gatewayConfig.mcp.policies.apiKey.keys[0].key, rotatedSystem.token);
  assert.equal(stderr, '');
});
