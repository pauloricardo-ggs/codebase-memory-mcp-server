import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const root = path.resolve(import.meta.dirname, '../..');
const execFileAsync = promisify(execFile);

test('Compose inclui Ollama, Docling, Open WebUI e bootstrap persistentes', async () => {
  const compose = await readFile(path.join(root, 'compose.yaml'), 'utf8');
  for (const service of ['ollama:', 'docling:', 'open-webui:', 'openwebui-bootstrap:']) {
    assert.match(compose, new RegExp(`^  ${service}`, 'm'));
  }
  assert.match(compose, /CONTENT_EXTRACTION_ENGINE: docling/);
  assert.match(compose, /RAG_EMBEDDING_MODEL: bge-m3/);
  assert.match(compose, /DOCLING_SERVER_URL: http:\/\/docling:5001/);
  assert.match(compose, /MCP_ADMIN_URL: http:\/\/proxy:8080\/mcp/);
  assert.match(compose, /\.\/data\/secrets:\/run\/cbm-secrets:ro/);
  assert.match(compose, /ollama-data:/);
  assert.match(compose, /openwebui-data:/);
});

test('presets de exemplo selecionam o padrão e carregam parâmetros e integrações esperados', async () => {
  const manifest = JSON.parse(await readFile(path.join(root, 'openwebui/bootstrap/models.json'), 'utf8'));
  assert.deepEqual(manifest.models.map(model => model.id), ['business-model-sample', 'code-model-sample']);
  for (const model of manifest.models) {
    assert.equal(model.base_model_id, 'qwen3:14b');
    assert.equal(model.params.num_ctx, 32768);
    assert.equal(model.params.function_calling, 'native');
  }
  assert.equal(manifest.models[0].params.temperature, 0.3);
  assert.deepEqual(manifest.models[1].meta.toolIds, ['server:mcp:mcp-admin']);
  assert.match(manifest.models[0].params.system, /fontes divergirem/);
  assert.match(manifest.models[1].params.system, /acesso administrativo total/);
});

test('instalador sugere qwen3:14b e bootstrap é executável', async () => {
  const install = await readFile(path.join(root, 'install.sh'), 'utf8');
  assert.match(install, /OLLAMA_CHAT_MODEL='qwen3:14b'/);
  assert.match(install, /ask_ollama_model/);
  assert.match(install, /E-mail administrativo/);
  assert.match(install, /mínimo de 6 caracteres/);
  assert.match(install, /OPENWEBUI_ADMIN_NAME='Admin'/);
  assert.match(install, /OPENWEBUI_PREVIOUS_NAME.*OPENWEBUI_ADMIN_NAME/);
  assert.match(install, /docker_compose wait openwebui-bootstrap/);
  assert.match(install, /migrate_openwebui_admin_command/);
  assert.match(install, /api\/v1\/users\/\$\{user_id\}\/update/);
  assert.match(install, /Sincronizando a credencial administrativa do Open WebUI/);
  const bootstrap = await readFile(path.join(root, 'openwebui/bootstrap/bootstrap.sh'), 'utf8');
  assert.match(bootstrap, /configs\/tool_servers\/verify/);
  assert.match(bootstrap, /config:\{enable:true\}/);
  assert.match(bootstrap, /\.base_model_id = \$chat_model/);
  if (process.platform !== 'win32') {
    const mode = (await stat(path.join(root, 'openwebui/bootstrap/bootstrap.sh'))).mode & 0o777;
    assert.ok(mode & 0o100, 'bootstrap.sh deve ser executável');
  }
});

test('reinstalação migra o administrador existente do Open WebUI sem recriar o volume', async () => {
  const requests = [];
  const server = createServer(async (request, response) => {
    let raw = '';
    for await (const chunk of request) raw += chunk;
    const payload = raw ? JSON.parse(raw) : {};
    requests.push({ url: request.url, authorization: request.headers.authorization, payload });

    response.setHeader('content-type', 'application/json');
    if (request.url === '/api/v1/auths/signin') {
      response.end(JSON.stringify({ id: 'admin-id', token: 'session-token' }));
      return;
    }
    if (request.url === '/api/v1/users/admin-id/update') {
      response.end(JSON.stringify({ email: 'novo@example.com', name: 'Admin', role: 'admin' }));
      return;
    }
    response.statusCode = 404;
    response.end('{}');
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'cbm-openwebui-install-'));
  try {
    await copyFile(path.join(root, 'install.sh'), path.join(temporaryRoot, 'install.sh'));
    await mkdir(path.join(temporaryRoot, 'data/secrets'), { recursive: true });
    await writeFile(path.join(temporaryRoot, '.env'), `OPENWEBUI_PORT=${server.address().port}\n`);
    await writeFile(
      path.join(temporaryRoot, 'data/secrets/openwebui.env'),
      'WEBUI_ADMIN_EMAIL=admin@local.invalid\nWEBUI_ADMIN_PASSWORD=senha-antiga\nWEBUI_ADMIN_NAME=admin@local.invalid\nWEBUI_SECRET_KEY=segredo-preservado\n'
    );

    await execFileAsync('bash', ['-c', `
      source "$1"
      ADMIN_EMAIL="$TEST_NEW_EMAIL"
      OPENWEBUI_PREVIOUS_EMAIL="$TEST_OLD_EMAIL"
      OPENWEBUI_PREVIOUS_PASSWORD="$TEST_OLD_PASSWORD"
      OPENWEBUI_DESIRED_PASSWORD="$TEST_NEW_PASSWORD"
      migrate_openwebui_admin_command
    `, 'test', path.join(temporaryRoot, 'install.sh')], {
      env: {
        ...process.env,
        TEST_NEW_EMAIL: 'novo@example.com',
        TEST_OLD_EMAIL: 'admin@local.invalid',
        TEST_OLD_PASSWORD: 'senha-antiga',
        TEST_NEW_PASSWORD: 'senha-nova'
      }
    });

    assert.equal(requests.length, 2);
    assert.deepEqual(requests[0], {
      url: '/api/v1/auths/signin',
      authorization: undefined,
      payload: { email: 'admin@local.invalid', password: 'senha-antiga' }
    });
    assert.deepEqual(requests[1], {
      url: '/api/v1/users/admin-id/update',
      authorization: 'Bearer session-token',
      payload: {
        email: 'novo@example.com',
        name: 'Admin',
        password: 'senha-nova'
      }
    });
    assert.equal(
      await readFile(path.join(temporaryRoot, 'data/secrets/openwebui.env'), 'utf8'),
      'WEBUI_ADMIN_EMAIL=novo@example.com\nWEBUI_ADMIN_PASSWORD=senha-nova\nWEBUI_ADMIN_NAME=Admin\nWEBUI_SECRET_KEY=segredo-preservado\n'
    );
  } finally {
    await new Promise(resolve => server.close(resolve));
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
