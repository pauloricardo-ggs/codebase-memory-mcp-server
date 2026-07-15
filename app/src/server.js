import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdir, readdir, rm, rmdir, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertSafeSegment, gitAuthEnvironment, indexRepositoryArguments, loadCredentials, loadState, run, safeChild, saveCredentials, saveState, slugify } from './lib.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = process.env.APP_DATA_DIR || '/data/app';
const REPOSITORIES_DIR = process.env.CBM_ALLOWED_ROOT || '/data/repositories';
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const GITHUB_CREDENTIALS_FILE = path.join(DATA_DIR, 'secrets', 'github-credentials.json');
const CBM_BIN = process.env.CBM_BIN || 'codebase-memory-mcp';
const PORT = Number(process.env.PORT || 3000);

await Promise.all([mkdir(DATA_DIR, { recursive: true }), mkdir(REPOSITORIES_DIR, { recursive: true })]);

let state = await loadState(STATE_FILE);
const storedGithubCredentials = await loadCredentials(GITHUB_CREDENTIALS_FILE);
let githubToken = storedGithubCredentials?.token ?? '';
let githubUser = storedGithubCredentials?.user ?? null;
let githubCache = { at: 0, repositories: [] };
const jobs = [];
const locks = new Set();

function json(response, status, payload) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(payload));
}

function errorResponse(response, error, status = 400) {
  console.error(error);
  json(response, status, { error: error.message || 'Erro inesperado.' });
}

async function body(request) {
  let raw = '';
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > 1_000_000) throw new Error('Corpo da requisição muito grande.');
  }
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { throw new Error('JSON inválido.'); }
}

function workspace(id) {
  assertSafeSegment(id, 'Workspace');
  const found = state.workspaces.find(item => item.id === id);
  if (!found) throw new Error('Workspace não encontrado.');
  return found;
}

function repository(workspaceId, repositoryId) {
  workspace(workspaceId);
  assertSafeSegment(repositoryId, 'Repositório');
  const found = state.repositories.find(item => item.workspaceId === workspaceId && item.id === repositoryId);
  if (!found) throw new Error('Repositório não encontrado.');
  return found;
}

async function persist() { await saveState(STATE_FILE, state); }

function publicRepository(item) {
  return { ...item, path: undefined };
}

async function github(endpoint, token = githubToken) {
  if (!token) throw new Error('Conecte o GitHub primeiro.');
  const response = await fetch(`https://api.github.com${endpoint}`, {
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${token}`,
      'user-agent': 'codebase-memory-admin',
      'x-github-api-version': '2022-11-28'
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) throw new Error('Token do GitHub inválido ou expirado.');
    if (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0') throw new Error('O limite de requisições do GitHub foi atingido. Tente novamente mais tarde.');
    throw new Error(payload.message ? `GitHub: ${payload.message}` : `GitHub respondeu com HTTP ${response.status}.`);
  }
  return payload;
}

async function listGithubRepositories() {
  if (Date.now() - githubCache.at < 120_000) return githubCache.repositories;
  const all = [];
  for (let page = 1; page <= 20; page += 1) {
    const items = await github(`/user/repos?visibility=all&affiliation=owner,collaborator,organization_member&per_page=100&page=${page}`);
    all.push(...items);
    if (items.length < 100) break;
  }
  githubCache = {
    at: Date.now(),
    repositories: all.map(item => ({
      id: item.id,
      name: item.name,
      fullName: item.full_name,
      description: item.description,
      private: item.private,
      archived: item.archived,
      language: item.language,
      defaultBranch: item.default_branch,
      updatedAt: item.updated_at,
      cloneUrl: item.clone_url
    })).sort((a, b) => a.fullName.localeCompare(b.fullName))
  };
  return githubCache.repositories;
}

function createJob(type, label, lockKey, operation) {
  if (locks.has(lockKey)) throw new Error('Já existe uma operação em andamento para este recurso.');
  const job = { id: randomUUID(), type, label, status: 'queued', progress: 0, log: '', createdAt: new Date().toISOString() };
  jobs.unshift(job);
  jobs.splice(50);
  locks.add(lockKey);

  setImmediate(async () => {
    job.status = 'running';
    job.startedAt = new Date().toISOString();
    const log = text => { job.log = `${job.log}${text}`.slice(-50_000); };
    try {
      await operation(job, log);
      job.progress = 100;
      job.status = 'completed';
    } catch (error) {
      job.status = 'failed';
      job.error = error.message;
      const [workspaceId, repositoryId] = lockKey.split('/');
      const affectedRepository = state.repositories.find(item => item.workspaceId === workspaceId && item.id === repositoryId);
      if (affectedRepository) affectedRepository.status = 'error';
      log(`\n${error.message}\n`);
    } finally {
      job.finishedAt = new Date().toISOString();
      locks.delete(lockKey);
      await persist().catch(console.error);
    }
  });
  return job;
}

async function routeApi(request, response, url) {
  const parts = url.pathname.split('/').filter(Boolean).slice(1);

  if (request.method === 'GET' && url.pathname === '/api/health') {
    return json(response, 200, { status: 'ok' });
  }
  if (url.pathname === '/api/github/connection') {
    if (request.method === 'GET') return json(response, 200, { connected: Boolean(githubToken), user: githubUser });
    if (request.method === 'POST') {
      const input = await body(request);
      const token = String(input.token ?? '').trim();
      const user = await github('/user', token);
      const persistedUser = { login: user.login, name: user.name, avatarUrl: user.avatar_url };
      await saveCredentials(GITHUB_CREDENTIALS_FILE, { token, user: persistedUser });
      githubToken = token;
      githubUser = persistedUser;
      githubCache = { at: 0, repositories: [] };
      return json(response, 200, { connected: true, user: githubUser });
    }
    if (request.method === 'DELETE') {
      await rm(GITHUB_CREDENTIALS_FILE, { force: true });
      githubToken = ''; githubUser = null; githubCache = { at: 0, repositories: [] };
      return json(response, 200, { connected: false });
    }
  }
  if (request.method === 'GET' && url.pathname === '/api/github/repositories') {
    const search = (url.searchParams.get('search') || '').toLowerCase();
    const repositories = (await listGithubRepositories()).filter(item => !search || `${item.fullName} ${item.description || ''}`.toLowerCase().includes(search));
    return json(response, 200, { repositories });
  }
  if (url.pathname === '/api/workspaces' && request.method === 'GET') {
    return json(response, 200, { workspaces: state.workspaces.map(item => ({ ...item, repositoryCount: state.repositories.filter(repo => repo.workspaceId === item.id).length })) });
  }
  if (url.pathname === '/api/workspaces' && request.method === 'POST') {
    const input = await body(request);
    const name = String(input.name ?? '').trim();
    const id = slugify(name);
    if (!name || !id) throw new Error('Informe um nome válido para o workspace.');
    if (state.workspaces.some(item => item.id === id)) throw new Error('Já existe um workspace com esse nome.');
    const item = { id, name: name.slice(0, 80), description: String(input.description ?? '').trim().slice(0, 240), createdAt: new Date().toISOString() };
    await mkdir(safeChild(REPOSITORIES_DIR, id), { recursive: true });
    state.workspaces.push(item);
    await persist();
    return json(response, 201, item);
  }

  if (parts[0] === 'workspaces' && parts[1]) {
    const workspaceId = parts[1];
    const selectedWorkspace = workspace(workspaceId);
    if (parts.length === 2 && request.method === 'GET') {
      return json(response, 200, { workspace: selectedWorkspace, repositories: state.repositories.filter(item => item.workspaceId === workspaceId).map(publicRepository) });
    }
    if (parts.length === 2 && request.method === 'DELETE') {
      if (state.repositories.some(item => item.workspaceId === workspaceId)) throw new Error('Remova os repositórios antes de excluir o workspace.');
      const directory = safeChild(REPOSITORIES_DIR, workspaceId);
      const remainingFiles = await readdir(directory).catch(error => error.code === 'ENOENT' ? [] : Promise.reject(error));
      if (remainingFiles.length) throw new Error('A pasta do workspace contém arquivos não gerenciados e não pode ser excluída.');
      state.workspaces = state.workspaces.filter(item => item.id !== workspaceId);
      await rmdir(directory).catch(error => { if (error.code !== 'ENOENT') throw error; });
      await persist();
      return json(response, 200, { deleted: true });
    }
    if (parts[2] === 'repositories' && parts.length === 3 && request.method === 'POST') {
      const input = await body(request);
      if (!Array.isArray(input.repositories) || !input.repositories.length) throw new Error('Selecione pelo menos um repositório.');
      const available = await listGithubRepositories();
      const selected = input.repositories.map(fullName => available.find(item => item.fullName === fullName));
      if (selected.some(item => !item)) throw new Error('Um dos repositórios selecionados não está disponível.');
      const requestedIds = new Map();
      for (const remote of selected) {
        const repositoryId = slugify(remote.name);
        const collision = requestedIds.get(repositoryId) || state.repositories.find(item => item.workspaceId === workspaceId && item.id === repositoryId && item.fullName !== remote.fullName)?.fullName;
        if (collision) throw new Error(`Os repositórios ${collision} e ${remote.fullName} usam o mesmo nome de pasta. Adicione-os em workspaces diferentes.`);
        requestedIds.set(repositoryId, remote.fullName);
      }
      const created = [];
      for (const remote of selected) {
        const id = slugify(remote.name);
        if (state.repositories.some(item => item.workspaceId === workspaceId && item.id === id)) continue;
        const target = safeChild(REPOSITORIES_DIR, workspaceId, id);
        const item = { id, workspaceId, name: remote.name, fullName: remote.fullName, description: remote.description, private: remote.private, language: remote.language, defaultBranch: remote.defaultBranch, status: 'cloning', path: target, createdAt: new Date().toISOString() };
        state.repositories.push(item);
        const job = createJob('clone', `Clonando ${remote.fullName}`, `${workspaceId}/${id}`, async (currentJob, log) => {
          await run('git', ['clone', remote.cloneUrl, target], { env: gitAuthEnvironment(githubToken), onOutput: log });
          const commit = (await run('git', ['rev-parse', '--short', 'HEAD'], { cwd: target })).stdout.trim();
          item.status = 'ready'; item.commit = commit; item.lastSyncAt = new Date().toISOString(); currentJob.progress = 100;
        });
        item.activeJobId = job.id;
        created.push(publicRepository(item));
      }
      await persist();
      return json(response, 202, { repositories: created });
    }
    if (parts[2] === 'repositories' && parts[3]) {
      const item = repository(workspaceId, parts[3]);
      if (parts.length === 4 && request.method === 'DELETE') {
        if (locks.has(`${workspaceId}/${item.id}`)) throw new Error('Aguarde a operação atual terminar.');
        await rm(item.path, { recursive: true, force: true });
        state.repositories = state.repositories.filter(repo => repo !== item);
        await persist();
        return json(response, 200, { deleted: true });
      }
      if (parts[4] === 'sync' && request.method === 'POST') {
        const job = createJob('sync', `Sincronizando ${item.fullName}`, `${workspaceId}/${item.id}`, async (_job, log) => {
          item.status = 'syncing';
          await run('git', ['pull', '--ff-only'], { cwd: item.path, env: gitAuthEnvironment(githubToken), onOutput: log });
          item.commit = (await run('git', ['rev-parse', '--short', 'HEAD'], { cwd: item.path })).stdout.trim();
          item.status = 'ready'; item.lastSyncAt = new Date().toISOString();
        });
        item.activeJobId = job.id; await persist(); return json(response, 202, job);
      }
      if (parts[4] === 'index' && request.method === 'POST') {
        const job = createJob('index', `Indexando ${item.fullName}`, `${workspaceId}/${item.id}`, async (_job, log) => {
          item.status = 'indexing';
          await run(CBM_BIN, indexRepositoryArguments(item.path), { onOutput: log });
          item.status = 'indexed'; item.lastIndexedAt = new Date().toISOString();
        });
        item.activeJobId = job.id; await persist(); return json(response, 202, job);
      }
    }
  }
  if (request.method === 'GET' && url.pathname === '/api/jobs') return json(response, 200, { jobs });
  return json(response, 404, { error: 'Rota não encontrada.' });
}

function serveStatic(response, pathname) {
  const requested = pathname === '/' ? 'index.html' : pathname.slice(1);
  const file = safeChild(PUBLIC_DIR, requested);
  const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
  stat(file).then(info => {
    if (!info.isFile()) throw new Error('not found');
    response.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' });
    createReadStream(file).pipe(response);
  }).catch(() => { response.writeHead(404); response.end('Not found'); });
}

http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) await routeApi(request, response, url);
    else serveStatic(response, url.pathname);
  } catch (error) { errorResponse(response, error); }
}).listen(PORT, '0.0.0.0', () => console.log(`Codebase Memory Admin em http://0.0.0.0:${PORT}`));
