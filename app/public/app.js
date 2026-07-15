const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const content = $('#content');
const modal = $('#modal');
let currentView = 'workspaces';
let currentWorkspace = null;
let jobs = [];

const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' })[char]);
const date = value => value ? new Intl.DateTimeFormat('pt-BR', { dateStyle:'short', timeStyle:'short' }).format(new Date(value)) : '—';

async function api(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { 'content-type':'application/json', ...options.headers } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Não foi possível concluir a operação.');
  return payload;
}

function toast(message, type = '') {
  const node = document.createElement('div'); node.className = `toast ${type}`; node.textContent = message; $('#toasts').append(node); setTimeout(() => node.remove(), 4500);
}

function openModal(html) { $('#modal-content').innerHTML = html; modal.showModal(); }
function closeModal() { modal.close(); }
function setHeader(title, breadcrumb = 'Administração', actions = '') { $('#page-title').textContent = title; $('#breadcrumb').textContent = breadcrumb; $('#header-actions').innerHTML = actions; }

async function renderGithub() {
  const connection = await api('/api/github/connection');
  $('#github-card').innerHTML = connection.connected ? `<div class="github-user"><img src="${escapeHtml(connection.user.avatarUrl)}" alt=""><div><strong>${escapeHtml(connection.user.name || connection.user.login)}</strong><small>@${escapeHtml(connection.user.login)}</small></div><button class="button small" data-action="disconnect-github">Sair</button></div>` : `<p>Conecte o GitHub para localizar e clonar seus repositórios.</p><button class="button small" data-action="connect-github">Conectar GitHub</button>`;
  return connection;
}

async function renderWorkspaces() {
  currentView = 'workspaces'; currentWorkspace = null;
  setHeader('Workspaces', 'Administração', '<button class="button primary" data-action="new-workspace">＋ Novo workspace</button>');
  const { workspaces } = await api('/api/workspaces');
  content.innerHTML = workspaces.length ? `<div class="toolbar"><span class="subtle">${workspaces.length} workspace${workspaces.length === 1 ? '' : 's'} configurado${workspaces.length === 1 ? '' : 's'}</span></div><div class="grid">${workspaces.map(item => `<article class="card workspace-card" data-workspace="${item.id}"><div class="card-head"><span class="workspace-icon">⌘</span><span class="badge">${item.repositoryCount} repo${item.repositoryCount === 1 ? '' : 's'}</span></div><h3>${escapeHtml(item.name)}</h3><p>${escapeHtml(item.description || 'Sem descrição')}</p><div class="card-meta"><span>Criado em ${date(item.createdAt)}</span><span>Ver →</span></div></article>`).join('')}</div>` : `<div class="empty"><div><div class="empty-icon">⌘</div><h2>Organize seus repositórios em workspaces</h2><p>Crie um workspace para agrupar projetos relacionados e iniciar clones e indexações.</p><button class="button primary" data-action="new-workspace">Criar primeiro workspace</button></div></div>`;
}

async function renderWorkspace(id) {
  currentView = 'workspace'; currentWorkspace = id;
  const { workspace, repositories } = await api(`/api/workspaces/${id}`);
  setHeader(workspace.name, 'Workspaces / Detalhes', '<button class="button" data-action="delete-workspace">Excluir workspace</button> <button class="button primary" data-action="add-repositories">＋ Adicionar repositórios</button>');
  content.innerHTML = repositories.length ? `<div class="toolbar"><button class="button small" data-action="back">← Voltar</button><span class="subtle">${repositories.length} repositório${repositories.length === 1 ? '' : 's'}</span></div><div class="repo-list">${repositories.map(repo => `<article class="repo-row"><div class="repo-title"><span class="icon">◇</span><div><strong>${escapeHtml(repo.fullName)}</strong><small>${escapeHtml(repo.description || 'Sem descrição')}</small></div></div><div class="repo-cell">${escapeHtml(repo.language || '—')}<small>${escapeHtml(repo.defaultBranch || '—')}</small></div><div class="repo-cell"><span class="status ${repo.status}">${escapeHtml(repo.status)}</span><small>${repo.commit || 'sem commit'}</small></div><div class="repo-actions"><button class="button small" data-action="sync" data-repo="${repo.id}">Sincronizar</button><button class="button small" data-action="index" data-repo="${repo.id}">Indexar</button><button class="button small danger" data-action="delete-repo" data-repo="${repo.id}" data-name="${escapeHtml(repo.fullName)}">Excluir</button></div></article>`).join('')}</div>` : `<button class="button small" data-action="back">← Voltar</button><div class="empty" style="margin-top:18px"><div><div class="empty-icon">◇</div><h2>Nenhum repositório neste workspace</h2><p>Selecione repositórios disponíveis na sua conta do GitHub e eles serão clonados automaticamente.</p><button class="button primary" data-action="add-repositories">Adicionar repositórios</button></div></div>`;
}

function renderJobs() {
  currentView = 'jobs'; currentWorkspace = null;
  setHeader('Operações', 'Administração');
  content.innerHTML = jobs.length ? jobs.map(job => `<article class="card job"><div class="job-top"><div><h3>${escapeHtml(job.label)}</h3><span class="status ${job.status}">${job.status}</span></div><time>${date(job.createdAt)}</time></div>${job.log ? `<pre>${escapeHtml(job.log)}</pre>` : ''}${job.error ? `<p style="color:var(--danger)">${escapeHtml(job.error)}</p>` : ''}<div class="progress ${['queued','running'].includes(job.status) ? 'indeterminate' : ''}"><i style="width:${job.progress}%"></i></div></article>`).join('') : '<div class="empty"><div><div class="empty-icon">↻</div><h2>Nenhuma operação recente</h2><p>Clones, sincronizações e indexações aparecerão aqui.</p></div></div>';
}

function newWorkspaceModal() {
  openModal(`<h2 class="modal-title">Novo workspace</h2><p class="modal-copy">Use um nome que represente um produto, domínio ou conjunto de serviços.</p><div class="field"><label for="workspace-name">Nome</label><input id="workspace-name" maxlength="80" autofocus placeholder="Ex.: Plataforma de pagamentos"></div><div class="field"><label for="workspace-description">Descrição</label><textarea id="workspace-description" maxlength="240" placeholder="Contexto opcional do workspace"></textarea></div><div class="modal-actions"><button class="button" value="cancel">Cancelar</button><button class="button primary" type="button" data-action="save-workspace">Criar workspace</button></div>`);
}

function connectGithubModal() {
  openModal(`<h2 class="modal-title">Conectar ao GitHub</h2><p class="modal-copy">Use um token fine-grained com acesso de leitura a metadados e conteúdos. O token permanece apenas na memória e será descartado ao reiniciar ou desconectar.</p><div class="field"><label for="github-token">Personal access token</label><input id="github-token" type="password" autocomplete="off" placeholder="github_pat_…"></div><div class="modal-actions"><button class="button" value="cancel">Cancelar</button><button class="button primary" type="button" data-action="save-github">Conectar</button></div>`);
}

async function repositoryPicker() {
  const connection = await renderGithub();
  if (!connection.connected) { connectGithubModal(); return; }
  openModal('<h2 class="modal-title">Adicionar repositórios</h2><p class="modal-copy">Carregando repositórios disponíveis…</p><div class="loading"><i></i> Consultando GitHub</div>');
  try {
    const { repositories } = await api('/api/github/repositories');
    $('#modal-content').innerHTML = `<h2 class="modal-title">Adicionar repositórios</h2><p class="modal-copy">Selecione um ou mais repositórios. Arquivados aparecem na lista, mas ficam desabilitados.</p><input class="search" id="repo-search" placeholder="Buscar por nome ou descrição…"><div class="picker" id="repo-picker">${repositoryRows(repositories)}</div><div class="modal-actions"><button class="button" value="cancel">Cancelar</button><button class="button primary" type="button" data-action="clone-selected">Adicionar selecionados</button></div>`;
    $('#repo-search').addEventListener('input', event => { $('#repo-picker').innerHTML = repositoryRows(repositories.filter(repo => `${repo.fullName} ${repo.description || ''}`.toLowerCase().includes(event.target.value.toLowerCase()))); });
  } catch (error) { closeModal(); toast(error.message, 'error'); }
}

function repositoryRows(repositories) { return repositories.map(repo => `<label class="picker-row"><input type="checkbox" name="repository" value="${escapeHtml(repo.fullName)}" ${repo.archived ? 'disabled' : ''}><span><strong>${escapeHtml(repo.fullName)}</strong><small>${escapeHtml(repo.description || 'Sem descrição')}</small></span><span class="badge">${repo.private ? 'privado' : 'público'}</span></label>`).join('') || '<div class="empty" style="min-height:120px">Nenhum repositório encontrado.</div>'; }

async function refreshJobs() {
  try {
    jobs = (await api('/api/jobs')).jobs;
    const active = jobs.filter(job => ['queued','running'].includes(job.status)).length;
    $('#job-count').textContent = active; $('#job-count').hidden = !active;
    if (currentView === 'jobs') renderJobs();
    if (currentView === 'workspace') renderWorkspace(currentWorkspace);
  } catch {}
}

document.addEventListener('click', async event => {
  const target = event.target.closest('[data-action], [data-workspace], [data-view]'); if (!target) return;
  const action = target.dataset.action;
  try {
    if (target.dataset.view === 'workspaces') return renderWorkspaces();
    if (target.dataset.view === 'jobs') return renderJobs();
    if (target.dataset.workspace) return renderWorkspace(target.dataset.workspace);
    if (action === 'new-workspace') return newWorkspaceModal();
    if (action === 'back') return renderWorkspaces();
    if (action === 'connect-github') return connectGithubModal();
    if (action === 'disconnect-github') { await api('/api/github/connection', { method:'DELETE' }); await renderGithub(); return toast('GitHub desconectado.'); }
    if (action === 'save-github') { target.disabled = true; await api('/api/github/connection', { method:'POST', body:JSON.stringify({ token:$('#github-token').value }) }); closeModal(); await renderGithub(); return toast('GitHub conectado.'); }
    if (action === 'save-workspace') { target.disabled = true; await api('/api/workspaces', { method:'POST', body:JSON.stringify({ name:$('#workspace-name').value, description:$('#workspace-description').value }) }); closeModal(); toast('Workspace criado.'); return renderWorkspaces(); }
    if (action === 'add-repositories') return repositoryPicker();
    if (action === 'clone-selected') { const selected = $$('input[name=repository]:checked').map(input => input.value); if (!selected.length) throw new Error('Selecione pelo menos um repositório.'); target.disabled = true; await api(`/api/workspaces/${currentWorkspace}/repositories`, { method:'POST', body:JSON.stringify({ repositories:selected }) }); closeModal(); toast('Clonagem iniciada.'); await refreshJobs(); return renderWorkspace(currentWorkspace); }
    if (action === 'sync' || action === 'index') { await api(`/api/workspaces/${currentWorkspace}/repositories/${target.dataset.repo}/${action}`, { method:'POST' }); toast(action === 'sync' ? 'Sincronização iniciada.' : 'Indexação iniciada.'); return refreshJobs(); }
    if (action === 'delete-repo') { if (!confirm(`Excluir ${target.dataset.name}? O clone local será removido.`)) return; await api(`/api/workspaces/${currentWorkspace}/repositories/${target.dataset.repo}`, { method:'DELETE' }); toast('Repositório removido.'); return renderWorkspace(currentWorkspace); }
    if (action === 'delete-workspace') { if (!confirm('Excluir este workspace vazio?')) return; await api(`/api/workspaces/${currentWorkspace}`, { method:'DELETE' }); toast('Workspace removido.'); return renderWorkspaces(); }
  } catch (error) { target.disabled = false; toast(error.message, 'error'); }
});

await Promise.all([renderGithub(), renderWorkspaces(), refreshJobs()]);
setInterval(refreshJobs, 3000);
