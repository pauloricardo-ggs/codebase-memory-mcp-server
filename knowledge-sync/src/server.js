import http from 'node:http';
import { readFile, mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createServiceAccountAssertion, fileChecksum, folderRoot, GOOGLE_FOLDER_MIME, isTargetDue, MANAGED_ROOT, migrateTargetSchedule, nextRunAt, normalizeTargetInput, publicTarget, sanitizeDriveName, scheduledSlot } from './lib.js';

const PORT = Number(process.env.PORT || 3002);
const DATA_DIR = process.env.SYNC_DATA_DIR || '/data';
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const GOOGLE_CREDENTIALS_FILE = process.env.GOOGLE_APPLICATION_CREDENTIALS || '/run/secrets/google-drive-service-account.json';
const API_TOKEN_FILE = process.env.KNOWLEDGE_SYNC_TOKEN_FILE || '/run/secrets/knowledge-sync-token';
const OPENWEBUI_URL = String(process.env.OPENWEBUI_URL || 'http://open-webui:8080').replace(/\/+$/, '');
const GOOGLE_API_URL = String(process.env.GOOGLE_API_URL || 'https://www.googleapis.com').replace(/\/+$/, '');
const OPENWEBUI_EMAIL = process.env.WEBUI_ADMIN_EMAIL || '';
const OPENWEBUI_PASSWORD = process.env.WEBUI_ADMIN_PASSWORD || '';
const DEFAULT_SYNC_TIMEZONE = process.env.KNOWLEDGE_SYNC_TIMEZONE || 'America/Maceio';
const HISTORY_LIMIT = 200;

await mkdir(DATA_DIR, { recursive: true });
const apiToken = (await readFile(API_TOKEN_FILE, 'utf8')).trim();
if (!apiToken) throw new Error('Token interno do knowledge-sync não configurado.');
if (!OPENWEBUI_EMAIL || !OPENWEBUI_PASSWORD) throw new Error('Credencial administrativa do Open WebUI não configurada.');

async function loadState() {
  try {
    const parsed = JSON.parse(await readFile(STATE_FILE, 'utf8'));
    return { version: parsed.version || 1, targets: parsed.targets || [], history: parsed.history || [] };
  } catch (error) {
    if (error.code === 'ENOENT') return { version: 1, targets: [], history: [] };
    throw error;
  }
}

let state = await loadState();
let mutation = Promise.resolve();
let persistence = Promise.resolve();
const running = new Set();
const queued = new Set();
let executionQueue = Promise.resolve();
let googleCredentials = null;
let googleCredentialsRaw = '';
let googleCredentialsError = null;
let googleToken = null;
let openwebuiToken = null;

async function refreshGoogleCredentials(required = false) {
  try {
    const raw = await readFile(GOOGLE_CREDENTIALS_FILE, 'utf8');
    if (raw !== googleCredentialsRaw) {
      const parsed = JSON.parse(raw);
      if (parsed?.type !== 'service_account' || !parsed.client_email || !parsed.private_key) {
        throw new Error('O JSON não representa uma Service Account válida.');
      }
      googleCredentials = parsed;
      googleCredentialsRaw = raw;
      googleCredentialsError = null;
      googleToken = null;
    }
    return googleCredentials;
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'EISDIR') {
      googleCredentials = null;
      googleCredentialsRaw = '';
      googleCredentialsError = null;
      googleToken = null;
      if (!required) return null;
      throw new Error('Configure a Service Account do Google Drive no painel administrativo.');
    }
    googleCredentials = null;
    googleCredentialsRaw = '';
    googleCredentialsError = error.message;
    googleToken = null;
    if (!required) return null;
    throw new Error(`Credencial do Google Drive inválida: ${error.message}`);
  }
}

await refreshGoogleCredentials(false);

function withMutation(operation) {
  const next = mutation.then(operation, operation);
  mutation = next.catch(() => {});
  return next;
}

function persist() {
  const operation = async () => {
    const temporary = `${STATE_FILE}.tmp`;
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, STATE_FILE);
  };
  persistence = persistence.then(operation, operation);
  return persistence;
}

let scheduleMigrationNeeded = state.version < 2;
state.targets = state.targets.map(target => {
  const migration = migrateTargetSchedule(target, DEFAULT_SYNC_TIMEZONE);
  scheduleMigrationNeeded ||= migration.changed;
  return migration.target;
});
state.version = 2;
if (scheduleMigrationNeeded) await persist();

function isBusy(knowledgeBaseId) {
  return running.has(knowledgeBaseId) || queued.has(knowledgeBaseId);
}

function json(response, status, payload) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(payload));
}

async function requestBody(request) {
  let raw = '';
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > 1_000_000) throw new Error('Corpo da requisição muito grande.');
  }
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { throw new Error('JSON inválido.'); }
}

async function getGoogleToken() {
  await refreshGoogleCredentials(true);
  if (googleToken && googleToken.expiresAt > Date.now() + 60_000) return googleToken.value;
  const assertion = createServiceAccountAssertion(googleCredentials);
  const form = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion
  });
  const response = await fetch(googleCredentials.token_uri || 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form,
    signal: AbortSignal.timeout(30_000)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) throw new Error(`Falha ao autenticar no Google Drive: ${payload.error_description || payload.error || response.status}.`);
  googleToken = { value: payload.access_token, expiresAt: Date.now() + Number(payload.expires_in || 3600) * 1000 };
  return googleToken.value;
}

async function google(pathname, options = {}, retry = true) {
  const token = await getGoogleToken();
  const response = await fetch(`${GOOGLE_API_URL}${pathname}`, {
    ...options,
    headers: { authorization: `Bearer ${token}`, ...options.headers },
    signal: options.signal || AbortSignal.timeout(60_000)
  });
  if (response.status === 401 && retry) {
    googleToken = null;
    return google(pathname, options, false);
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(`Google Drive respondeu HTTP ${response.status}: ${payload.error?.message || 'requisição rejeitada'}.`);
  }
  return response;
}

async function listDriveFiles(query, orderBy = 'name') {
  const files = [];
  let pageToken = '';
  do {
    const params = new URLSearchParams({
      q: query,
      pageSize: '1000',
      orderBy,
      spaces: 'drive',
      fields: 'nextPageToken,files(id,name,mimeType,modifiedTime,size,md5Checksum,parents,trashed)',
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true'
    });
    if (pageToken) params.set('pageToken', pageToken);
    const response = await google(`/drive/v3/files?${params}`);
    const payload = await response.json();
    files.push(...(payload.files || []));
    pageToken = payload.nextPageToken || '';
  } while (pageToken);
  return files;
}

async function getDriveFile(id) {
  const params = new URLSearchParams({ fields: 'id,name,mimeType,modifiedTime,size,md5Checksum,parents,trashed', supportsAllDrives: 'true' });
  const response = await google(`/drive/v3/files/${encodeURIComponent(id)}?${params}`);
  return response.json();
}

async function assertNoOverlappingFolders(folders) {
  const selected = new Set(folders.map(folder => folder.id));
  const metadata = new Map(folders.map(folder => [folder.id, folder]));
  for (const folder of folders) {
    const pending = [...(folder.parents || [])];
    const visited = new Set();
    while (pending.length) {
      const parentId = pending.shift();
      if (!parentId || visited.has(parentId)) continue;
      visited.add(parentId);
      if (selected.has(parentId)) throw new Error('Não selecione ao mesmo tempo uma pasta e uma subpasta dela.');
      try {
        const parent = metadata.get(parentId) || await getDriveFile(parentId);
        metadata.set(parentId, parent);
        pending.push(...(parent.parents || []));
      } catch {
        // Uma pasta compartilhada diretamente pode ocultar seus ancestrais.
      }
    }
  }
}

const GOOGLE_EXPORTS = new Map([
  ['application/vnd.google-apps.document', { mime: 'text/plain', extension: '.txt' }],
  ['application/vnd.google-apps.spreadsheet', { mime: 'text/csv', extension: '.csv' }],
  ['application/vnd.google-apps.presentation', { mime: 'text/plain', extension: '.txt' }],
  ['application/vnd.google-apps.drawing', { mime: 'application/pdf', extension: '.pdf' }]
]);

function downloadableFile(file, relativePath, rootFolder) {
  const googleExport = GOOGLE_EXPORTS.get(file.mimeType);
  if (file.mimeType.startsWith('application/vnd.google-apps.') && !googleExport) return null;
  let filename = sanitizeDriveName(file.name, file.id);
  if (googleExport?.extension && !filename.toLowerCase().endsWith(googleExport.extension)) filename += googleExport.extension;
  return {
    sourceKey: `${rootFolder.id}:${file.id}`,
    driveFileId: file.id,
    folderId: rootFolder.id,
    path: relativePath,
    filename,
    mimeType: file.mimeType,
    exportMime: googleExport?.mime || null,
    checksum: fileChecksum(file)
  };
}

async function scanFolder(rootFolder, currentFolderId = rootFolder.id, relativePath = '', seen = new Set()) {
  if (seen.has(currentFolderId)) return [];
  seen.add(currentFolderId);
  const children = await listDriveFiles(`'${currentFolderId.replaceAll("'", "\\'")}' in parents and trashed = false`);
  const entries = [];
  for (const child of children) {
    if (child.mimeType === GOOGLE_FOLDER_MIME) {
      const childPath = [relativePath, sanitizeDriveName(child.name, child.id)].filter(Boolean).join('/');
      entries.push(...await scanFolder(rootFolder, child.id, childPath, seen));
      continue;
    }
    const entry = downloadableFile(child, relativePath, rootFolder);
    if (entry) entries.push(entry);
  }
  return entries;
}

async function downloadDriveFile(entry) {
  const suffix = entry.exportMime
    ? `/drive/v3/files/${encodeURIComponent(entry.driveFileId)}/export?mimeType=${encodeURIComponent(entry.exportMime)}`
    : `/drive/v3/files/${encodeURIComponent(entry.driveFileId)}?alt=media&supportsAllDrives=true`;
  const response = await google(suffix, { signal: AbortSignal.timeout(120_000) });
  return Buffer.from(await response.arrayBuffer());
}

async function signInOpenWebui() {
  const response = await fetch(`${OPENWEBUI_URL}/api/v1/auths/signin`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: OPENWEBUI_EMAIL, password: OPENWEBUI_PASSWORD }),
    signal: AbortSignal.timeout(30_000)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.token) throw new Error(`Falha ao autenticar no Open WebUI: ${payload.detail || response.status}.`);
  openwebuiToken = payload.token;
  return openwebuiToken;
}

async function openwebui(pathname, options = {}, retry = true) {
  const token = openwebuiToken || await signInOpenWebui();
  const response = await fetch(`${OPENWEBUI_URL}/api/v1${pathname}`, {
    ...options,
    headers: { authorization: `Bearer ${token}`, ...options.headers },
    signal: options.signal || AbortSignal.timeout(180_000)
  });
  if (response.status === 401 && retry) {
    openwebuiToken = null;
    return openwebui(pathname, options, false);
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(`Open WebUI respondeu HTTP ${response.status}: ${payload.detail || payload.error || 'requisição rejeitada'}.`);
  }
  return response;
}

async function getOpenWebuiPublicConfig(retry = true) {
  const token = openwebuiToken || await signInOpenWebui();
  const response = await fetch(`${OPENWEBUI_URL}/api/config`, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30_000)
  });
  if (response.status === 401 && retry) {
    openwebuiToken = null;
    return getOpenWebuiPublicConfig(false);
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Open WebUI respondeu HTTP ${response.status} ao consultar a integração do Drive.`);
  return payload;
}

function publicPickerConfig(config) {
  const clientId = String(config?.google_drive?.client_id || '');
  const apiKey = String(config?.google_drive?.api_key || '');
  const enabled = config?.features?.enable_google_drive_integration === true;
  return {
    enabled,
    configured: enabled && Boolean(clientId) && Boolean(apiKey),
    clientId: clientId || null,
    apiKeyConfigured: Boolean(apiKey),
    apiKeySuffix: apiKey ? apiKey.slice(-4) : null
  };
}

async function setPickerConfig(clientId, apiKey, enabled) {
  await openwebui('/configs/import', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      config: {
        'google_drive.enable': enabled,
        'google_drive.client_id': clientId,
        'google_drive.api_key': apiKey
      }
    })
  });
  return publicPickerConfig(await getOpenWebuiPublicConfig());
}

function validatePickerConfig(input) {
  const clientId = String(input.clientId || '').trim();
  const apiKey = String(input.apiKey || '').trim();
  if (!/^[^\s=]+\.apps\.googleusercontent\.com$/.test(clientId)) {
    throw new Error('Informe um OAuth Client ID válido, terminado em .apps.googleusercontent.com.');
  }
  if (apiKey.length < 20 || /[\s=]/.test(apiKey)) {
    throw new Error('Informe uma API Key válida do Google Picker, sem espaços.');
  }
  return { clientId, apiKey };
}

async function listKnowledgeBases() {
  const items = [];
  let page = 1;
  let total = Infinity;
  while (items.length < total) {
    const response = await openwebui(`/knowledge/?page=${page}`);
    const payload = await response.json();
    const current = payload.items || (Array.isArray(payload) ? payload : []);
    items.push(...current);
    total = Number(payload.total ?? items.length);
    if (!current.length) break;
    page += 1;
  }
  return items.map(item => ({ id: item.id, name: item.name, description: item.description || '', writeAccess: item.write_access !== false }));
}

async function createDirectory(knowledgeBaseId, name, parentId = null) {
  const response = await openwebui(`/knowledge/${knowledgeBaseId}/dirs/create`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, parent_id: parentId })
  });
  return response.json();
}

async function ensureDirectory(target, logicalPath) {
  const segments = logicalPath.split('/').filter(Boolean);
  let accumulated = '';
  let parentId = null;
  for (const segment of segments) {
    accumulated = accumulated ? `${accumulated}/${segment}` : segment;
    if (!target.directories[accumulated]) {
      const created = await createDirectory(target.knowledgeBaseId, segment, parentId);
      target.directories[accumulated] = created.id;
      await persist();
    }
    parentId = target.directories[accumulated];
  }
  return parentId;
}

async function uploadFile(target, entry, content, directoryId) {
  const form = new FormData();
  form.append('file', new Blob([content]), entry.filename);
  form.append('metadata', JSON.stringify({
    knowledge_id: target.knowledgeBaseId,
    file_hash: entry.checksum,
    directory_id: directoryId
  }));
  const response = await openwebui('/files/', { method: 'POST', body: form });
  const payload = await response.json();
  if (!payload.id) throw new Error(`Open WebUI não retornou o ID de ${entry.filename}.`);
  return payload.id;
}

async function cleanupFiles(knowledgeBaseId, fileIds) {
  if (!fileIds.length) return;
  await openwebui(`/knowledge/${knowledgeBaseId}/sync/cleanup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ file_ids: fileIds, dir_ids: [] })
  });
}

function recordHistory(target, run) {
  state.history.unshift({
    id: crypto.randomUUID(),
    knowledgeBaseId: target.knowledgeBaseId,
    knowledgeBaseName: target.knowledgeBaseName,
    ...run
  });
  state.history = state.history.slice(0, HISTORY_LIMIT);
}

async function executeTarget(target, trigger) {
  const startedAt = new Date().toISOString();
  const counters = { added: 0, modified: 0, deleted: 0, unchanged: 0 };
  try {
    const bases = await listKnowledgeBases();
    const knowledge = bases.find(item => item.id === target.knowledgeBaseId);
    if (!knowledge) throw new Error('Knowledge Base não encontrada ou sem acesso de escrita.');
    target.knowledgeBaseName = knowledge.name;

    const manifest = [];
    for (const configuredFolder of target.folders) {
      const metadata = await getDriveFile(configuredFolder.id);
      if (metadata.trashed || metadata.mimeType !== GOOGLE_FOLDER_MIME) throw new Error(`A pasta ${configuredFolder.name} não está disponível.`);
      configuredFolder.name = sanitizeDriveName(metadata.name, configuredFolder.name);
      const scanned = await scanFolder(configuredFolder);
      const basePath = folderRoot(configuredFolder);
      manifest.push(...scanned.map(entry => ({ ...entry, managedPath: [basePath, entry.path].filter(Boolean).join('/') })));
    }

    if (manifest.length === 0 && Object.keys(target.files).length > 0) {
      throw new Error('O Drive retornou uma origem vazia. Os arquivos existentes foram preservados por segurança.');
    }

    const currentKeys = new Set(manifest.map(entry => entry.sourceKey));
    for (const entry of manifest) {
      const previous = target.files[entry.sourceKey];
      if (previous && previous.checksum === entry.checksum && previous.managedPath === entry.managedPath && previous.filename === entry.filename) {
        counters.unchanged += 1;
        continue;
      }
      const content = await downloadDriveFile(entry);
      const directoryId = await ensureDirectory(target, entry.managedPath || MANAGED_ROOT);
      const newFileId = await uploadFile(target, entry, content, directoryId);
      target.files[entry.sourceKey] = {
        fileId: newFileId,
        driveFileId: entry.driveFileId,
        folderId: entry.folderId,
        checksum: entry.checksum,
        managedPath: entry.managedPath,
        filename: entry.filename
      };
      await persist();
      if (previous?.fileId) {
        await cleanupFiles(target.knowledgeBaseId, [previous.fileId]);
        counters.modified += 1;
      } else counters.added += 1;
    }

    const removed = Object.entries(target.files).filter(([sourceKey]) => !currentKeys.has(sourceKey));
    for (const [sourceKey, previous] of removed) {
      await cleanupFiles(target.knowledgeBaseId, [previous.fileId]);
      delete target.files[sourceKey];
      counters.deleted += 1;
      await persist();
    }

    const finishedAt = new Date().toISOString();
    target.lastRunAt = finishedAt;
    target.lastRunStatus = 'completed';
    target.lastRunSummary = counters;
    target.lastError = null;
    recordHistory(target, { trigger, status: 'completed', startedAt, finishedAt, ...counters });
    await persist();
    return counters;
  } catch (error) {
    const finishedAt = new Date().toISOString();
    target.lastRunAt = finishedAt;
    target.lastRunStatus = 'failed';
    target.lastError = error.message;
    recordHistory(target, { trigger, status: 'failed', startedAt, finishedAt, error: error.message, ...counters });
    await persist();
    throw error;
  }
}

function runTarget(knowledgeBaseId, trigger = 'manual', scheduledFor = null) {
  if (!state.targets.some(item => item.knowledgeBaseId === knowledgeBaseId)) throw new Error('Vínculo não encontrado.');
  if (isBusy(knowledgeBaseId)) throw new Error('Esta Knowledge Base já está na fila de sincronização.');
  queued.add(knowledgeBaseId);
  const operation = async () => {
    queued.delete(knowledgeBaseId);
    const target = state.targets.find(item => item.knowledgeBaseId === knowledgeBaseId);
    if (!target) return;
    running.add(knowledgeBaseId);
    try {
      if (scheduledFor) {
        target.lastScheduledAt = scheduledFor;
        await persist();
      }
      await executeTarget(target, trigger);
    } catch (error) {
      console.error(`Sincronização ${knowledgeBaseId} falhou:`, error.message);
    } finally {
      running.delete(knowledgeBaseId);
    }
  };
  executionQueue = executionQueue.then(operation, operation);
}

async function authorize(request) {
  const authorization = request.headers.authorization || '';
  return authorization === `Bearer ${apiToken}`;
}

async function route(request, response, url) {
  if (request.method === 'GET' && url.pathname === '/health') return json(response, 200, { status: 'ok' });
  if (!await authorize(request)) return json(response, 401, { error: 'Não autorizado.' });

  if (request.method === 'GET' && url.pathname === '/api/status') {
    await refreshGoogleCredentials(false);
    return json(response, 200, {
      configured: Boolean(googleCredentials),
      serviceAccountEmail: googleCredentials?.client_email || null,
      projectId: googleCredentials?.project_id || null,
      credentialsError: googleCredentialsError,
      defaultTimezone: DEFAULT_SYNC_TIMEZONE,
      running: [...running],
      queued: [...queued],
      targetCount: state.targets.length
    });
  }
  if (request.method === 'POST' && url.pathname === '/api/credentials/test') {
    const credentials = await refreshGoogleCredentials(true);
    await google('/drive/v3/files?pageSize=1&fields=files(id)&q=trashed%20%3D%20false');
    return json(response, 200, {
      configured: true,
      serviceAccountEmail: credentials.client_email,
      projectId: credentials.project_id || null,
      testedAt: new Date().toISOString()
    });
  }
  if (url.pathname === '/api/picker-config') {
    if (request.method === 'GET') {
      return json(response, 200, publicPickerConfig(await getOpenWebuiPublicConfig()));
    }
    if (request.method === 'PUT') {
      const { clientId, apiKey } = validatePickerConfig(await requestBody(request));
      const picker = await setPickerConfig(clientId, apiKey, true);
      if (!picker.configured) throw new Error('O Open WebUI não confirmou a ativação do Google Drive.');
      return json(response, 200, picker);
    }
    if (request.method === 'DELETE') {
      const picker = await setPickerConfig('', '', false);
      if (picker.enabled) throw new Error('O Open WebUI não confirmou a desativação do Google Drive.');
      return json(response, 200, picker);
    }
    return json(response, 405, { error: 'Método não permitido.' });
  }
  if (request.method === 'GET' && url.pathname === '/api/knowledge-bases') {
    return json(response, 200, { knowledgeBases: await listKnowledgeBases() });
  }
  if (request.method === 'GET' && url.pathname === '/api/folders') {
    const search = String(url.searchParams.get('search') || '').trim().toLocaleLowerCase('pt-BR');
    const folders = await listDriveFiles(`mimeType = '${GOOGLE_FOLDER_MIME}' and trashed = false`);
    const visible = folders
      .filter(folder => !search || folder.name.toLocaleLowerCase('pt-BR').includes(search) || folder.id.toLowerCase().includes(search))
      .map(folder => ({ id: folder.id, name: folder.name, parents: folder.parents || [] }))
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    return json(response, 200, { folders: visible, serviceAccountEmail: googleCredentials.client_email });
  }
  if (request.method === 'GET' && url.pathname === '/api/targets') {
    return json(response, 200, { targets: state.targets.map(item => publicTarget(item, isBusy(item.knowledgeBaseId))) });
  }
  if (request.method === 'GET' && url.pathname === '/api/history') {
    const knowledgeBaseId = url.searchParams.get('knowledgeBaseId');
    const history = knowledgeBaseId ? state.history.filter(item => item.knowledgeBaseId === knowledgeBaseId) : state.history;
    return json(response, 200, { history: history.slice(0, 100) });
  }
  if (request.method === 'POST' && url.pathname === '/api/targets/pause-all') {
    await withMutation(async () => {
      const now = new Date().toISOString();
      for (const target of state.targets) {
        target.enabled = false;
        target.updatedAt = now;
      }
      await persist();
    });
    return json(response, 200, { paused: state.targets.length });
  }

  const match = url.pathname.match(/^\/api\/targets\/([A-Za-z0-9_-]+)(?:\/(run))?$/);
  if (match && request.method === 'PUT' && !match[2]) {
    if (isBusy(match[1])) throw new Error('Aguarde a sincronização atual terminar antes de alterar o vínculo.');
    const input = normalizeTargetInput({ ...(await requestBody(request)), knowledgeBaseId: match[1] });
    const bases = await listKnowledgeBases();
    const knowledge = bases.find(item => item.id === input.knowledgeBaseId);
    if (!knowledge || !knowledge.writeAccess) throw new Error('Knowledge Base não encontrada ou sem permissão de escrita.');
    const validatedFolders = [];
    const validatedMetadata = [];
    for (const folder of input.folders) {
      const metadata = await getDriveFile(folder.id);
      if (metadata.trashed || metadata.mimeType !== GOOGLE_FOLDER_MIME) throw new Error(`${folder.name} não é uma pasta disponível no Google Drive.`);
      validatedFolders.push({ id: metadata.id, name: sanitizeDriveName(metadata.name, folder.name) });
      validatedMetadata.push(metadata);
    }
    await assertNoOverlappingFolders(validatedMetadata);
    await withMutation(async () => {
      const existing = state.targets.find(item => item.knowledgeBaseId === input.knowledgeBaseId);
      const now = new Date().toISOString();
      if (existing) Object.assign(existing, input, { folders: validatedFolders, knowledgeBaseName: knowledge.name, updatedAt: now, lastError: null });
      else state.targets.push({ ...input, folders: validatedFolders, knowledgeBaseName: knowledge.name, files: {}, directories: {}, createdAt: now, updatedAt: now, lastRunAt: null, lastRunStatus: null, lastRunSummary: null, lastError: null });
      await persist();
    });
    const target = state.targets.find(item => item.knowledgeBaseId === input.knowledgeBaseId);
    return json(response, 200, { target: publicTarget(target, isBusy(target.knowledgeBaseId)) });
  }
  if (match && request.method === 'POST' && match[2] === 'run') {
    runTarget(match[1], 'manual');
    return json(response, 202, { accepted: true });
  }
  if (match && request.method === 'DELETE' && !match[2]) {
    if (isBusy(match[1])) throw new Error('Aguarde a sincronização atual terminar antes de desvincular a base.');
    const target = state.targets.find(item => item.knowledgeBaseId === match[1]);
    if (!target) throw new Error('Vínculo não encontrado.');
    if (url.searchParams.get('deleteFiles') === 'true') {
      const fileIds = Object.values(target.files || {}).map(file => file.fileId).filter(Boolean);
      for (let index = 0; index < fileIds.length; index += 100) {
        await cleanupFiles(target.knowledgeBaseId, fileIds.slice(index, index + 100));
      }
    }
    state.targets = state.targets.filter(item => item !== target);
    await persist();
    return json(response, 200, { deleted: true });
  }
  return json(response, 404, { error: 'Rota não encontrada.' });
}

async function checkSchedules() {
  if (!await refreshGoogleCredentials(false)) return;
  for (const target of state.targets) {
    if (isTargetDue(target) && !isBusy(target.knowledgeBaseId)) {
      try { runTarget(target.knowledgeBaseId, 'schedule', scheduledSlot(target)); }
      catch (error) { console.error(`Não foi possível agendar ${target.knowledgeBaseId}:`, error.message); }
    }
  }
}

await checkSchedules();
setInterval(() => checkSchedules().catch(console.error), 30_000).unref();

http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  try { await route(request, response, url); }
  catch (error) {
    console.error(error);
    json(response, 400, { error: error.message || 'Erro inesperado.' });
  }
}).listen(PORT, '0.0.0.0', () => {
  console.log(`Knowledge Sync em http://0.0.0.0:${PORT}; próxima verificação ${state.targets.map(nextRunAt).filter(Boolean).sort()[0] || 'sem vínculos'}`);
});
