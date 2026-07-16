import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const root = path.resolve(import.meta.dirname, '../..');
const execFileAsync = promisify(execFile);

test('Compose inclui Ollama, Docling, Open WebUI, bootstrap e worker permanente', async () => {
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
  assert.match(compose, /context: \.\/openwebui/);
  assert.match(compose, /image: codebase-memory-open-webui:0\.10\.2-google-drive-config/);
  assert.match(compose, /^  knowledge-sync:/m);
  assert.doesNotMatch(compose, /profiles: \["google-drive"\]/);
  assert.match(compose, /KNOWLEDGE_SYNC_ENABLED: "true"/);
  assert.match(compose, /GOOGLE_APPLICATION_CREDENTIALS: \/run\/secrets\/google-drive-service-account.json/);
  assert.match(compose, /KNOWLEDGE_SYNC_URL: http:\/\/knowledge-sync:3002/);
});

test('imagem derivada lê as credenciais persistentes do Picker em tempo de execução', async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'cbm-openwebui-patch-'));
  try {
    const mainFile = path.join(temporaryRoot, 'main.py');
    await writeFile(mainFile, `keys = (
        'google_drive.enable',
        'onedrive.enable',
)
response = {
                'google_drive': {
                    'client_id': GOOGLE_DRIVE_CLIENT_ID,
                    'api_key': GOOGLE_DRIVE_API_KEY,
                },
}
`);
    await execFileAsync('python3', [path.join(root, 'openwebui/patch-google-drive-runtime.py'), mainFile]);
    const patched = await readFile(mainFile, 'utf8');
    assert.match(patched, /'google_drive\.client_id'/);
    assert.match(patched, /'google_drive\.api_key'/);
    assert.match(patched, /config\.get\('google_drive\.client_id'\)/);
    assert.match(patched, /config\.get\('google_drive\.api_key'\)/);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
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

test('painel administra vínculos entre pastas e Knowledge Bases pelo BFF interno', async () => {
  const [html, browser, styles, server] = await Promise.all([
    readFile(path.join(root, 'app/public/index.html'), 'utf8'),
    readFile(path.join(root, 'app/public/app.js'), 'utf8'),
    readFile(path.join(root, 'app/public/styles.css'), 'utf8'),
    readFile(path.join(root, 'app/src/server.js'), 'utf8')
  ]);
  assert.match(html, /data-view="knowledge-sync"/);
  assert.match(browser, /Vincular pastas/);
  assert.match(browser, /run-knowledge-sync/);
  assert.match(browser, /delete-knowledge-sync/);
  assert.match(browser, /drive-credentials-file/);
  assert.match(browser, /save-drive-credentials/);
  assert.match(browser, /test-drive-credentials/);
  assert.match(browser, /drive-picker-client-id/);
  assert.match(browser, /drive-picker-api-key/);
  assert.match(browser, /save-drive-picker/);
  assert.match(browser, /remove-drive-picker/);
  assert.match(browser, /\/api\/knowledge-sync\/picker-config/);
  assert.match(browser, /refreshKnowledgeSyncRows/);
  assert.doesNotMatch(browser, /setInterval\(\(\) => \{ if \(currentView === 'knowledge-sync'\) renderKnowledgeSync/);
  assert.match(styles, /knowledge-sync-identity \.workspace-icon \{[^}]*border-radius:50%/);
  assert.match(styles, /knowledge-sync-identity > div \{[^}]*min-width:0/);
  assert.match(styles, /knowledge-sync-identity small \{[^}]*overflow-wrap:anywhere/);
  assert.match(styles, /knowledge-sync-actions \{[^}]*grid-column:1 \/ -1/);
  assert.match(server, /url\.pathname\.startsWith\('\/api\/knowledge-sync'\)/);
  assert.match(server, /KNOWLEDGE_SYNC_TOKEN_FILE/);
  assert.match(server, /GOOGLE_DRIVE_SERVICE_ACCOUNT_FILE/);
  assert.match(server, /validateGoogleServiceAccount/);
});

test('painel confirma workspace com Enter e permite indexar o workspace aberto', async () => {
  const [browser, server] = await Promise.all([
    readFile(path.join(root, 'app/public/app.js'), 'utf8'),
    readFile(path.join(root, 'app/src/server.js'), 'utf8')
  ]);
  assert.match(browser, /modal\.querySelector\('form'\)\.addEventListener\('submit'/);
  assert.match(browser, /newWorkspaceModal[\s\S]*'save-workspace'/);
  for (const action of ['save-schedule', 'save-drive-picker', 'save-drive-credentials', 'save-knowledge-sync', 'save-mcp-user', 'save-mcp-access', 'save-github', 'clone-selected']) {
    assert.match(browser, new RegExp(`openModal\\([^;]+, '${action}'\\)`), `Enter deve acionar ${action}`);
  }
  assert.match(browser, /data-enter-action="add-drive-folder-id"/);
  assert.match(browser, /data-action="index-workspace"/);
  assert.match(browser, /\/api\/workspaces\/\$\{currentWorkspace\}\/index/);
  assert.match(server, /function runWorkspaceIndex/);
  assert.match(server, /parts\[2\] === 'index'.*request\.method === 'POST'/);
});

test('instalador sugere qwen3:14b e bootstrap é executável', async () => {
  const install = await readFile(path.join(root, 'install.sh'), 'utf8');
  assert.match(install, /OLLAMA_CHAT_MODEL='qwen3:14b'/);
  assert.match(install, /ask_ollama_model/);
  assert.match(install, /ask_ollama_gpu/);
  assert.match(install, /nvidia-smi --query-gpu=index,uuid,name,memory\.total/);
  assert.match(install, /nvidia-ctk runtime configure --runtime=docker/);
  assert.match(install, /write_ollama_gpu_compose_override/);
  assert.match(install, /validate_ollama_gpu_command/);
  assert.doesNotMatch(install, /ask_google_drive_integration/);
  assert.doesNotMatch(install, /Deseja habilitar o Google Drive/);
  assert.doesNotMatch(install, /OAuth Client ID do Google/);
  assert.doesNotMatch(install, /API Key do Google Picker/);
  assert.doesNotMatch(install, /JSON da Service Account para sincronização/);
  assert.doesNotMatch(install, /COMPOSE_PROFILES/);
  assert.match(install, /restart_and_validate_knowledge_sync_command/);
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

test('instalador seleciona múltiplas GPUs por índice e persiste os UUIDs no override', async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'cbm-ollama-gpu-install-'));
  try {
    await copyFile(path.join(root, 'install.sh'), path.join(temporaryRoot, 'install.sh'));
    const binaryDirectory = path.join(temporaryRoot, 'bin');
    await mkdir(binaryDirectory);
    const nvidiaSmi = path.join(binaryDirectory, 'nvidia-smi');
    await writeFile(nvidiaSmi, `#!/usr/bin/env bash
if [[ "$*" == *"--query-gpu=index,uuid,name,memory.total"* ]]; then
  printf '0, GPU-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa, NVIDIA RTX 4090, 24564\\n'
  printf '1, GPU-bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb, NVIDIA RTX 3090, 24576\\n'
else
  printf 'GPU 0: NVIDIA RTX 4090 (UUID: GPU-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa)\\n'
fi
`);
    await chmod(nvidiaSmi, 0o755);
    const selectionFile = path.join(temporaryRoot, 'selection');
    await execFileAsync('bash', ['-c', `
      export PATH="$2:$PATH"
      source "$1"
      ask_ollama_gpu <<< $'2\\n1,0\\n'
      printf '%s\\n%s\\n' "$OLLAMA_GPU_MODE" "$OLLAMA_GPU_DEVICE_IDS" >"$3"
      write_ollama_gpu_compose_override
    `, 'test', path.join(temporaryRoot, 'install.sh'), binaryDirectory, selectionFile]);

    assert.equal(
      await readFile(selectionFile, 'utf8'),
      'selected\nGPU-bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb,GPU-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa\n'
    );
    const override = await readFile(path.join(temporaryRoot, 'compose.gpu.yaml'), 'utf8');
    assert.match(override, /driver: nvidia/);
    assert.match(override, /GPU-bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/);
    assert.match(override, /GPU-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/);
    assert.match(override, /capabilities: \[gpu\]/);
    assert.doesNotMatch(override, /count: all/);

    await writeFile(
      path.join(temporaryRoot, '.env'),
      'OLLAMA_GPU_MODE=selected\nOLLAMA_GPU_DEVICE_IDS=GPU-bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb,GPU-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa\n'
    );
    const preservedSelectionFile = path.join(temporaryRoot, 'preserved-selection');
    await execFileAsync('bash', ['-c', `
      export PATH="$2:$PATH"
      source "$1"
      ask_ollama_gpu <<< $'\\n\\n'
      printf '%s\\n%s\\n' "$OLLAMA_GPU_MODE" "$OLLAMA_GPU_DEVICE_IDS" >"$3"
    `, 'test', path.join(temporaryRoot, 'install.sh'), binaryDirectory, preservedSelectionFile]);
    assert.equal(
      await readFile(preservedSelectionFile, 'utf8'),
      'selected\nGPU-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa,GPU-bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb\n'
    );

    await execFileAsync('bash', ['-c', `
      source "$1"
      OLLAMA_GPU_MODE=all
      write_ollama_gpu_compose_override
    `, 'test', path.join(temporaryRoot, 'install.sh')]);
    const allGpusOverride = await readFile(path.join(temporaryRoot, 'compose.gpu.yaml'), 'utf8');
    assert.match(allGpusOverride, /count: all/);
    assert.doesNotMatch(allGpusOverride, /device_ids:/);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test('modo CPU remove o override de GPU do Ollama', async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'cbm-ollama-cpu-install-'));
  try {
    await copyFile(path.join(root, 'install.sh'), path.join(temporaryRoot, 'install.sh'));
    await writeFile(path.join(temporaryRoot, 'compose.gpu.yaml'), 'configuração anterior');
    await execFileAsync('bash', ['-c', `
      source "$1"
      OLLAMA_GPU_MODE=cpu
      write_ollama_gpu_compose_override
    `, 'test', path.join(temporaryRoot, 'install.sh')]);
    await assert.rejects(readFile(path.join(temporaryRoot, 'compose.gpu.yaml')), { code: 'ENOENT' });
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test('instalador cria e protege somente o token interno do worker', async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'cbm-knowledge-sync-install-'));
  try {
    await copyFile(path.join(root, 'install.sh'), path.join(temporaryRoot, 'install.sh'));
    await execFileAsync('bash', ['-c', `
      source "$1"
      create_local_structure
      configure_google_drive_sync
    `, 'test', path.join(temporaryRoot, 'install.sh')]);

    const token = path.join(temporaryRoot, 'data/secrets/knowledge-sync/knowledge-sync-token');
    assert.match(await readFile(token, 'utf8'), /^[a-f0-9]{64}\n$/);
    if (process.platform !== 'win32') {
      assert.equal((await stat(token)).mode & 0o777, 0o600);
    }
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test('reinstalação migra segredos legados do worker para o subdiretório isolado', async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'cbm-knowledge-sync-migration-'));
  try {
    await copyFile(path.join(root, 'install.sh'), path.join(temporaryRoot, 'install.sh'));
    await mkdir(path.join(temporaryRoot, 'data/secrets'), { recursive: true });
    const legacyToken = `${'a'.repeat(64)}\n`;
    const legacyCredentials = JSON.stringify({
      type: 'service_account',
      client_email: 'sync@example.iam.gserviceaccount.com',
      private_key: '-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----\n'
    });
    await writeFile(path.join(temporaryRoot, 'data/secrets/knowledge-sync-token'), legacyToken);
    await writeFile(path.join(temporaryRoot, 'data/secrets/google-drive-service-account.json'), legacyCredentials);

    await execFileAsync('bash', ['-c', `
      source "$1"
      create_local_structure
      configure_google_drive_sync
    `, 'test', path.join(temporaryRoot, 'install.sh')]);

    const isolated = path.join(temporaryRoot, 'data/secrets/knowledge-sync');
    assert.equal(await readFile(path.join(isolated, 'knowledge-sync-token'), 'utf8'), legacyToken);
    assert.equal(await readFile(path.join(isolated, 'google-drive-service-account.json'), 'utf8'), legacyCredentials);
    await assert.rejects(readFile(path.join(temporaryRoot, 'data/secrets/knowledge-sync-token')), { code: 'ENOENT' });
    await assert.rejects(readFile(path.join(temporaryRoot, 'data/secrets/google-drive-service-account.json')), { code: 'ENOENT' });
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
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
      'CUSTOM_OPENWEBUI_SETTING=preservar\nWEBUI_ADMIN_EMAIL=admin@local.invalid\nWEBUI_ADMIN_PASSWORD=senha-antiga\nWEBUI_ADMIN_NAME=admin@local.invalid\nWEBUI_SECRET_KEY=segredo-preservado\nENABLE_GOOGLE_DRIVE_INTEGRATION=true\nGOOGLE_DRIVE_CLIENT_ID=cliente.apps.googleusercontent.com\nGOOGLE_DRIVE_API_KEY=api-key-preservada\n'
    );

    await execFileAsync('bash', ['-c', `
      source "$1"
      ADMIN_EMAIL="$TEST_NEW_EMAIL"
      OPENWEBUI_PREVIOUS_EMAIL="$TEST_OLD_EMAIL"
      OPENWEBUI_PREVIOUS_PASSWORD="$TEST_OLD_PASSWORD"
      OPENWEBUI_DESIRED_PASSWORD="$TEST_NEW_PASSWORD"
      ENABLE_GOOGLE_DRIVE_INTEGRATION=true
      GOOGLE_DRIVE_CLIENT_ID=cliente.apps.googleusercontent.com
      GOOGLE_DRIVE_API_KEY=api-key-preservada
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
      'CUSTOM_OPENWEBUI_SETTING=preservar\nENABLE_GOOGLE_DRIVE_INTEGRATION=true\nGOOGLE_DRIVE_CLIENT_ID=cliente.apps.googleusercontent.com\nGOOGLE_DRIVE_API_KEY=api-key-preservada\nWEBUI_ADMIN_EMAIL=novo@example.com\nWEBUI_ADMIN_PASSWORD=senha-nova\nWEBUI_ADMIN_NAME=Admin\nWEBUI_SECRET_KEY=segredo-preservado\n'
    );
  } finally {
    await new Promise(resolve => server.close(resolve));
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test('reinstalação preserva configuração legada do Picker sem gerenciá-la no instalador', async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'cbm-openwebui-gdrive-'));
  try {
    await copyFile(path.join(root, 'install.sh'), path.join(temporaryRoot, 'install.sh'));
    await mkdir(path.join(temporaryRoot, 'data/secrets'), { recursive: true });
    await writeFile(
      path.join(temporaryRoot, 'data/secrets/openwebui.env'),
      'CUSTOM_OPENWEBUI_SETTING=preservar\nENABLE_GOOGLE_DRIVE_INTEGRATION=true\nGOOGLE_DRIVE_CLIENT_ID=cliente-antigo.apps.googleusercontent.com\nGOOGLE_DRIVE_API_KEY=api-key-antiga\n'
    );

    await execFileAsync('bash', ['-c', `
      source "$1"
      write_openwebui_environment admin@example.com senha-secreta Admin webui-secret
    `, 'test', path.join(temporaryRoot, 'install.sh')]);

    assert.equal(
      await readFile(path.join(temporaryRoot, 'data/secrets/openwebui.env'), 'utf8'),
      'CUSTOM_OPENWEBUI_SETTING=preservar\nENABLE_GOOGLE_DRIVE_INTEGRATION=true\nGOOGLE_DRIVE_CLIENT_ID=cliente-antigo.apps.googleusercontent.com\nGOOGLE_DRIVE_API_KEY=api-key-antiga\nWEBUI_ADMIN_EMAIL=admin@example.com\nWEBUI_ADMIN_PASSWORD=senha-secreta\nWEBUI_ADMIN_NAME=Admin\nWEBUI_SECRET_KEY=webui-secret\n'
    );
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
