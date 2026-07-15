const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const content = $('#content');
const modal = $('#modal');
let currentView = 'workspaces';
let currentWorkspace = null;
let jobs = [];
let selectedRepositories = new Set();
let selectedMcpRepositories = new Set();
let mcpAccessOptions = [];
let currentMcpUsers = [];
let publicConfig = {};

const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' })[char]);
const date = value => value ? new Intl.DateTimeFormat('pt-BR', { dateStyle:'short', timeStyle:'short' }).format(new Date(value)) : '—';

async function api(url, options = {}) {
  const adminUrl = url.startsWith('/api/') ? `/admin${url}` : url;
  const response = await fetch(adminUrl, { ...options, headers: { 'content-type':'application/json', ...options.headers } });
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
function setNavigation(view) { $$('[data-view]').forEach(item => item.classList.toggle('active', item.dataset.view === view)); }
modal.addEventListener('close', () => {
  if (modal.open) return;
  $('#modal-content').replaceChildren();
});

function graphUrl(project = '') {
  const url = new URL('/', location.origin);
  if (project) {
    url.searchParams.set('tab', 'graph');
    url.searchParams.set('project', project);
  }
  return url.toString();
}

function mcpPanelUrl() {
  const url = new URL(location.href);
  url.port = String(publicConfig.agentgatewayUiPort);
  url.pathname = '/mcp-panel/';
  url.search = '';
  url.hash = '';
  return url.toString();
}

async function renderGithub() {
  const connection = await api('/api/github/connection');
  $('#github-card').innerHTML = connection.connected ? `<div class="github-user"><img src="${escapeHtml(connection.user.avatarUrl)}" alt=""><div><strong>${escapeHtml(connection.user.name || connection.user.login)}</strong><small>@${escapeHtml(connection.user.login)}</small></div><button class="button small" data-action="disconnect-github">Sair</button></div>` : `<p>Conecte o GitHub para localizar e clonar seus repositórios.</p><button class="button small" data-action="connect-github">Conectar GitHub</button>`;
  return connection;
}

async function renderWorkspaces() {
  currentView = 'workspaces'; currentWorkspace = null;
  setNavigation('workspaces');
  setHeader('Workspaces', 'Administração', '<button class="button primary" data-action="new-workspace">＋ Novo workspace</button>');
  const { workspaces } = await api('/api/workspaces');
  content.innerHTML = workspaces.length ? `<div class="toolbar"><span class="subtle">${workspaces.length} workspace${workspaces.length === 1 ? '' : 's'} configurado${workspaces.length === 1 ? '' : 's'}</span></div><div class="grid">${workspaces.map(item => `<article class="card workspace-card" data-workspace="${item.id}"><div class="card-head"><span class="workspace-icon">⌘</span><span class="badge">${item.repositoryCount} repo${item.repositoryCount === 1 ? '' : 's'}</span></div><h3>${escapeHtml(item.name)}</h3><p>${escapeHtml(item.description || 'Sem descrição')}</p><div class="schedule-summary ${item.updateSchedule.enabled ? '' : 'disabled'}"><strong>${item.updateSchedule.enabled ? escapeHtml(item.updateSchedule.description) : 'Atualização automática desativada'}</strong>${item.updateSchedule.enabled && item.updateSchedule.nextRunAt ? `<small>Próxima: ${date(item.updateSchedule.nextRunAt)}</small>` : ''}</div><div class="card-meta"><span>Criado em ${date(item.createdAt)}</span><span>Ver →</span></div></article>`).join('')}</div>` : `<div class="empty"><div><div class="empty-icon">⌘</div><h2>Organize seus repositórios em workspaces</h2><p>Crie um workspace para agrupar projetos relacionados e iniciar clones e indexações.</p><button class="button primary" data-action="new-workspace">Criar primeiro workspace</button></div></div>`;
}

function repositoryRow(repo) {
  const visibleStatus = repo.syncStatus === 'syncing' ? 'syncing' : repo.syncStatus === 'error' ? 'sync-error' : repo.status;
  return `
    <article class="repo-row">
      <div class="repo-title">
        <span class="icon">◇</span>
        <div class="repo-identity">
          <strong>${escapeHtml(repo.fullName)}</strong>
          <small>${escapeHtml(repo.description || 'Sem descrição')}</small>
          ${repo.project ? `<span class="project-id" title="Identificador usado nas chamadas MCP">ID MCP: <code>${escapeHtml(repo.project)}</code></span>` : ''}
          ${repo.language ? `<span class="language-badge">${escapeHtml(repo.language)}</span>` : ''}
        </div>
      </div>

      <div class="git-reference" aria-label="Branch e commit">
        <small>Branch / commit</small>
        <div>
          <strong><span aria-hidden="true">⑂</span> ${escapeHtml(repo.defaultBranch || '—')}</strong>
          <span class="git-separator">·</span>
          <code>${escapeHtml(repo.commit || 'sem commit')}</code>
        </div>
      </div>

      <div class="repo-status">
        <small>Status</small>
        <span class="status ${escapeHtml(visibleStatus)}" ${repo.syncError ? `title="${escapeHtml(repo.syncError)}"` : ''}>${escapeHtml(visibleStatus)}</span>
      </div>

      <div class="repo-actions">
        ${repo.project ? `<button class="button small graph-button" data-action="open-graph-ui" data-project="${escapeHtml(repo.project)}">Explorar ↗</button>` : ''}
        <button class="button small" data-action="sync" data-repo="${repo.id}">Sincronizar</button>
        <button class="button small" data-action="index" data-repo="${repo.id}">Indexar</button>
        <button class="button small danger" data-action="delete-repo" data-repo="${repo.id}" data-name="${escapeHtml(repo.fullName)}">Excluir</button>
      </div>
    </article>`;
}

async function renderWorkspace(id) {
  currentView = 'workspace'; currentWorkspace = id;
  setNavigation('workspaces');
  const { workspace, repositories } = await api(`/api/workspaces/${id}`);
  setHeader(workspace.name, 'Workspaces / Detalhes', '<button class="button" data-action="delete-workspace">Excluir workspace</button> <button class="button primary" data-action="add-repositories">＋ Adicionar repositórios</button>');
  const schedule = workspace.updateSchedule;
  const mcpAccess = workspace.mcpAccess || {};
  const mcpActive = mcpAccess.status === 'active';
  const mcpCard = `<section class="card schedule-card"><div><div class="schedule-title"><h2>Token MCP do workspace</h2><span class="status ${mcpActive ? 'active' : 'revoked'}">${mcpActive ? 'Ativo' : 'Revogado'}</span></div><p>Esta credencial acompanha automaticamente todos os repositórios adicionados ou removidos deste workspace.</p><div class="schedule-details"><span><small>Token</small><code>${escapeHtml(mcpAccess.keyPrefix || 'não provisionado')}</code></span><span><small>Gerado em</small><strong>${date(mcpAccess.tokenCreatedAt)}</strong></span></div></div><div class="schedule-actions"><div class="repo-actions">${mcpActive ? `<button class="button small" data-action="reveal-workspace-token">Exibir token</button><button class="button small" data-action="rotate-workspace-token">Gerar novo token</button><button class="button small danger" data-action="revoke-workspace-token">Revogar</button>` : `<button class="button small primary" data-action="reactivate-workspace-token">Reativar</button>`}</div></div></section>`;
  const scheduleCard = `<section class="card schedule-card"><div><div class="schedule-title"><h2>Atualização automática</h2><span class="status ${schedule.enabled ? 'active' : 'revoked'}">${schedule.enabled ? 'Ativada' : 'Desativada'}</span></div><p class="schedule-description">${escapeHtml(schedule.description)}</p><p>Executa somente <code>git pull</code>. A atualização do índice permanece sob responsabilidade do watcher.</p><div class="schedule-details"><span><small>Expressão cron</small><code>${escapeHtml(schedule.cron)}</code></span><span><small>Fuso</small><strong>${escapeHtml(schedule.timezone)}</strong></span><span><small>Próxima execução</small><strong>${date(schedule.nextRunAt)}</strong></span><span><small>Última execução</small><strong>${date(schedule.lastRunAt)}${schedule.lastRunStatus ? ` · ${escapeHtml(schedule.lastRunStatus)}` : ''}</strong></span></div></div><div class="schedule-actions"><label class="switch-control" data-action="toggle-schedule" data-enabled="${schedule.enabled}" title="${schedule.enabled ? 'Desativar rotina' : 'Ativar rotina'}"><input type="checkbox" ${schedule.enabled ? 'checked' : ''}><span class="switch-track" aria-hidden="true"></span><span>${schedule.enabled ? 'Ativada' : 'Desativada'}</span></label><div class="repo-actions"><button class="button small" data-action="run-workspace-sync">Executar agora</button><button class="button small" data-action="edit-schedule">Editar cron</button></div></div></section>`;
  content.innerHTML = `<div class="toolbar"><button class="button small" data-action="back">← Voltar</button><span class="subtle">${repositories.length} repositório${repositories.length === 1 ? '' : 's'}</span></div>${mcpCard}${scheduleCard}${repositories.length ? `<div class="repo-list">${repositories.map(repositoryRow).join('')}</div>` : `<div class="empty" style="margin-top:18px"><div><div class="empty-icon">◇</div><h2>Nenhum repositório neste workspace</h2><p>Selecione repositórios disponíveis na sua conta do GitHub e eles serão clonados automaticamente.</p><button class="button primary" data-action="add-repositories">Adicionar repositórios</button></div></div>`}`;
}

function editScheduleModal(schedule) {
  const [minute, hour, day, month, weekday] = schedule.cron.split(' ');
  openModal(`<h2 class="modal-title">Atualização automática</h2><p class="modal-copy">Configure os cinco campos do cron separadamente. Use <code>*</code> para qualquer valor, vírgula para listas e <code>*/n</code> para intervalos.</p><div class="cron-fields"><div class="field"><label for="schedule-minute">Minuto</label><input id="schedule-minute" value="${escapeHtml(minute)}" placeholder="0"><small>0–59</small></div><div class="field"><label for="schedule-hour">Hora</label><input id="schedule-hour" value="${escapeHtml(hour)}" placeholder="*"><small>0–23</small></div><div class="field"><label for="schedule-day">Dia do mês</label><input id="schedule-day" value="${escapeHtml(day)}" placeholder="*"><small>1–31</small></div><div class="field"><label for="schedule-month">Mês</label><input id="schedule-month" value="${escapeHtml(month)}" placeholder="*"><small>1–12</small></div><div class="field"><label for="schedule-weekday">Dia da semana</label><input id="schedule-weekday" value="${escapeHtml(weekday)}" placeholder="*"><small>0–7, domingo</small></div></div><div class="cron-preview"><small>Configuração atual</small><strong>${escapeHtml(schedule.description)}</strong><code>${escapeHtml(schedule.cron)}</code></div><div class="field"><label for="schedule-timezone">Fuso horário</label><input id="schedule-timezone" value="${escapeHtml(schedule.timezone)}" placeholder="America/Maceio"></div><label class="switch-control switch-modal"><input id="schedule-enabled" type="checkbox" ${schedule.enabled ? 'checked' : ''}><span class="switch-track" aria-hidden="true"></span><span>Rotina ativada</span></label><div class="modal-actions"><button class="button" value="cancel">Cancelar</button><button class="button primary" type="button" data-action="save-schedule">Salvar</button></div>`);
}

function renderJobs() {
  currentView = 'jobs'; currentWorkspace = null;
  setNavigation('jobs');
  setHeader('Operações', 'Administração');
  content.innerHTML = jobs.length ? jobs.map(job => `<article class="card job"><div class="job-top"><div><h3>${escapeHtml(job.label)}</h3><span class="status ${job.status}">${job.status}</span></div><time>${date(job.createdAt)}</time></div>${job.log ? `<pre>${escapeHtml(job.log)}</pre>` : ''}${job.error ? `<p style="color:var(--danger)">${escapeHtml(job.error)}</p>` : ''}<div class="progress ${['queued','running'].includes(job.status) ? 'indeterminate' : ''}"><i style="width:${job.progress}%"></i></div></article>`).join('') : '<div class="empty"><div><div class="empty-icon">↻</div><h2>Nenhuma operação recente</h2><p>Clones, sincronizações e indexações aparecerão aqui.</p></div></div>';
}

function mcpUserRow(user) {
  const active = user.status === 'active';
  const repositoryCount = user.repositoryIds?.length || 0;
  return `<article class="mcp-user-row">
    <div class="mcp-user-identity">
      <span class="user-avatar">${escapeHtml(user.name.slice(0, 2).toUpperCase())}</span>
      <div><strong>${escapeHtml(user.name)}</strong><small>${escapeHtml(user.identity)}</small>${user.description ? `<p>${escapeHtml(user.description)}</p>` : ''}</div>
    </div>
    <div class="mcp-user-access"><small>Repositórios</small><strong>${repositoryCount}</strong><span>permitido${repositoryCount === 1 ? '' : 's'}</span></div>
    <div class="mcp-key-reference"><small>Token</small><code>${escapeHtml(user.keyPrefix || 'sem token')}</code></div>
    <div class="mcp-user-status"><small>Status</small><span class="status ${active ? 'active' : 'revoked'}">${active ? 'Ativo' : 'Revogado'}</span></div>
    <div class="mcp-user-dates"><small>${active ? 'Token gerado' : 'Revogado em'}</small><span>${date(active ? user.tokenCreatedAt : user.revokedAt)}</span></div>
    <div class="repo-actions">
      <button class="button small" data-action="edit-mcp-access" data-user="${user.id}">Editar acessos</button>
      ${active
        ? `<button class="button small" data-action="rotate-mcp-token" data-user="${user.id}" data-name="${escapeHtml(user.name)}">Gerar novo token</button><button class="button small danger" data-action="revoke-mcp-token" data-user="${user.id}" data-name="${escapeHtml(user.name)}">Revogar</button>`
        : `<button class="button small primary" data-action="reactivate-mcp-user" data-user="${user.id}" data-name="${escapeHtml(user.name)}">Reativar</button>`}
      <button class="button small danger" data-action="delete-mcp-user" data-user="${user.id}" data-name="${escapeHtml(user.name)}">Excluir</button>
    </div>
  </article>`;
}

async function renderMcpUsers() {
  currentView = 'mcp-users'; currentWorkspace = null;
  setNavigation('mcp-users');
  setHeader('Usuários MCP', 'Administração / Acesso MCP', '<button class="button primary" data-action="new-mcp-user">＋ Novo usuário</button>');
  const [{ users, accessMode, systemAccess }, accessOptions] = await Promise.all([
    api('/api/mcp-users'),
    api('/api/mcp-access-options')
  ]);
  currentMcpUsers = users;
  mcpAccessOptions = accessOptions.workspaces;
  const activeCount = users.filter(user => user.status === 'active').length;
  const totalActive = activeCount + (systemAccess ? 1 : 0);
  const modeCopy = `${totalActive} token${totalActive === 1 ? '' : 's'} ativo${totalActive === 1 ? '' : 's'}, incluindo a credencial técnica. Requisições sem uma chave válida são bloqueadas.`;
  content.innerHTML = `<div class="access-banner ${accessMode}"><div><strong>${accessMode === 'strict' ? 'Autenticação obrigatória' : 'Acesso inicial sem token'}</strong><p>${modeCopy}</p></div><code>${escapeHtml(new URL('/mcp', location.origin).toString())}</code></div>
    <article class="mcp-system-card"><div><span class="user-avatar">SYS</span><div><strong>Sistema / Playground</strong><p>Credencial técnica com acesso irrestrito, criada automaticamente para validações da instalação e uso manual no MCP Playground.</p></div></div><div class="repo-actions"><button class="button small" data-action="reveal-system-token">Exibir token</button><button class="button small danger" data-action="rotate-system-token">Gerar novo token</button></div></article>
    ${users.length
      ? `<div class="toolbar"><span class="subtle">${users.length} usuário${users.length === 1 ? '' : 's'} · ${activeCount} ativo${activeCount === 1 ? '' : 's'}</span></div><div class="mcp-user-list">${users.map(mcpUserRow).join('')}</div>`
      : `<div class="empty"><div><div class="empty-icon">♙</div><h2>Nenhum desenvolvedor cadastrado</h2><p>O endpoint já está protegido pela credencial técnica. Crie tokens individuais para os desenvolvedores que utilizarão o MCP.</p><button class="button primary" data-action="new-mcp-user">Criar primeiro usuário</button></div></div>`}`;
}

function mcpAccessPicker() {
  const repositories = mcpAccessOptions.flatMap(workspace => workspace.repositories);
  return `<div class="field"><label>Repositórios permitidos</label><p class="field-help">O workspace apenas seleciona seus repositórios atuais em conjunto. A permissão salva é individual por repositório.</p><div class="mcp-access-picker">${mcpAccessOptions.map(workspace => {
    const empty = workspace.repositories.length === 0;
    return `<section class="mcp-access-workspace" data-access-workspace="${escapeHtml(workspace.id)}"><label class="mcp-access-workspace-head"><input type="checkbox" name="mcp-workspace" ${empty ? 'disabled' : ''}><span><strong>${escapeHtml(workspace.name)}</strong><small>${workspace.repositories.length} repo${workspace.repositories.length === 1 ? '' : 's'}</small></span></label><div class="mcp-access-repositories">${workspace.repositories.map(repository => `<label class="mcp-access-repository"><input type="checkbox" name="mcp-repository" value="${escapeHtml(repository.id)}" ${selectedMcpRepositories.has(repository.id) ? 'checked' : ''}><span><strong>${escapeHtml(repository.fullName)}</strong><small>${repository.indexed ? `ID MCP: ${escapeHtml(repository.project)}` : 'Aguardando indexação'}</small></span><span class="badge ${repository.indexed ? '' : 'pending'}">${repository.indexed ? 'indexado' : 'não indexado'}</span></label>`).join('') || '<p class="mcp-access-empty">Nenhum repositório neste workspace.</p>'}</div></section>`;
  }).join('') || '<p class="mcp-access-empty">Crie um workspace e adicione repositórios antes de cadastrar usuários MCP.</p>'}</div><div class="picker-summary"><span>${repositories.length} ${repositories.length === 1 ? 'disponível' : 'disponíveis'}</span><strong id="mcp-access-selection">0 selecionados</strong></div></div>`;
}

function updateMcpAccessSelection() {
  $$('.mcp-access-workspace').forEach(section => {
    const workspaceInput = $('input[name=mcp-workspace]', section);
    const repositoryInputs = $$('input[name=mcp-repository]', section);
    const selected = repositoryInputs.filter(input => input.checked).length;
    if (workspaceInput) {
      workspaceInput.checked = repositoryInputs.length > 0 && selected === repositoryInputs.length;
      workspaceInput.indeterminate = selected > 0 && selected < repositoryInputs.length;
    }
  });
  selectedMcpRepositories = new Set($$('input[name=mcp-repository]:checked').map(input => input.value));
  const count = selectedMcpRepositories.size;
  const summary = $('#mcp-access-selection');
  if (summary) summary.textContent = `${count} selecionado${count === 1 ? '' : 's'}`;
  const save = $('[data-action="save-mcp-user"], [data-action="save-mcp-access"]');
  if (save) save.disabled = count === 0;
}

function newMcpUserModal() {
  selectedMcpRepositories = new Set();
  openModal(`<h2 class="modal-title">Novo usuário MCP</h2><p class="modal-copy">Um token individual será gerado e exibido uma única vez após o cadastro.</p><div class="field"><label for="mcp-user-name">Nome</label><input id="mcp-user-name" maxlength="100" autofocus placeholder="Ex.: Maria Silva"></div><div class="field"><label for="mcp-user-identity">E-mail ou login</label><input id="mcp-user-identity" maxlength="160" placeholder="maria@empresa.com"></div><div class="field"><label for="mcp-user-description">Descrição</label><textarea id="mcp-user-description" maxlength="240" placeholder="Time ou finalidade do acesso"></textarea></div>${mcpAccessPicker()}<div class="modal-actions"><button class="button" value="cancel">Cancelar</button><button class="button primary" type="button" data-action="save-mcp-user" disabled>Criar e gerar token</button></div>`);
  updateMcpAccessSelection();
}

function editMcpAccessModal(user) {
  selectedMcpRepositories = new Set(user.repositoryIds || []);
  openModal(`<h2 class="modal-title">Acessos de ${escapeHtml(user.name)}</h2><p class="modal-copy">Alterações entram em vigor nas próximas chamadas e não exigem gerar outro token.</p>${mcpAccessPicker()}<div class="modal-actions"><button class="button" value="cancel">Cancelar</button><button class="button primary" type="button" data-action="save-mcp-access" data-user="${escapeHtml(user.id)}">Salvar acessos</button></div>`);
  updateMcpAccessSelection();
}

function mcpTokenModal(name, token, revisable = false) {
  openModal(`<h2 class="modal-title">Token de ${escapeHtml(name)}</h2><p class="modal-copy token-warning">${revisable ? 'Este token pode ser consultado novamente no detalhe do workspace. Trate-o como um segredo.' : 'Copie este token agora. Por segurança, ele não será exibido novamente pelo painel.'}</p><div class="token-box"><code id="generated-mcp-token">${escapeHtml(token)}</code><button class="button small" type="button" data-action="copy-mcp-token">Copiar token</button></div><div class="client-example"><small>Cabeçalho de autenticação</small><code>Authorization: Bearer ${escapeHtml(token)}</code></div><div class="modal-actions"><button class="button primary" value="cancel">Concluir</button></div>`);
}

async function copyText(value) {
  if (!value) throw new Error('O token não está mais disponível. Gere ou exiba o token novamente.');
  if (window.isSecureContext && navigator.clipboard?.writeText) {
    try { await navigator.clipboard.writeText(value); return 'clipboard'; } catch { /* use fallback below */ }
  }
  const input = document.createElement('textarea');
  input.value = value;
  input.readOnly = true;
  input.setAttribute('aria-hidden', 'true');
  input.style.cssText = 'position:fixed;top:0;left:0;width:2px;height:2px;padding:0;border:0;opacity:.01;z-index:9999';
  document.body.append(input);
  input.focus({ preventScroll:true });
  input.select();
  input.setSelectionRange(0, value.length);
  let copied = false;
  try { copied = document.execCommand('copy'); } catch { /* browser blocked legacy clipboard */ }
  input.remove();
  if (copied) return 'legacy';

  const tokenNode = $('#generated-mcp-token');
  if (tokenNode) {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(tokenNode);
    selection.removeAllRanges();
    selection.addRange(range);
  }
  window.prompt('A cópia automática foi bloqueada pelo navegador. Copie o token abaixo:', value);
  return 'manual';
}

function newWorkspaceModal() {
  openModal(`<h2 class="modal-title">Novo workspace</h2><p class="modal-copy">Use um nome que represente um produto, domínio ou conjunto de serviços.</p><div class="field"><label for="workspace-name">Nome</label><input id="workspace-name" maxlength="80" autofocus placeholder="Ex.: Plataforma de pagamentos"></div><div class="field"><label for="workspace-description">Descrição</label><textarea id="workspace-description" maxlength="240" placeholder="Contexto opcional do workspace"></textarea></div><div class="modal-actions"><button class="button" value="cancel">Cancelar</button><button class="button primary" type="button" data-action="save-workspace">Criar workspace</button></div>`);
}

function connectGithubModal() {
  openModal(`<h2 class="modal-title">Conectar ao GitHub</h2><p class="modal-copy">Use um token fine-grained com acesso de leitura a metadados e conteúdos. Ele será armazenado localmente, com acesso restrito, e preservado ao reiniciar ou atualizar o painel.</p><div class="field"><label for="github-token">Personal access token</label><input id="github-token" type="password" autocomplete="off" placeholder="github_pat_…"></div><div class="modal-actions"><button class="button" value="cancel">Cancelar</button><button class="button primary" type="button" data-action="save-github">Conectar e salvar</button></div>`);
}

async function repositoryPicker() {
  const connection = await renderGithub();
  if (!connection.connected) { connectGithubModal(); return; }
  openModal('<h2 class="modal-title">Adicionar repositórios</h2><p class="modal-copy">Carregando repositórios disponíveis…</p><div class="loading"><i></i> Consultando GitHub</div>');
  try {
    const [{ repositories }, workspaceData] = await Promise.all([
      api('/api/github/repositories'),
      api(`/api/workspaces/${currentWorkspace}`)
    ]);
    const existing = new Set(workspaceData.repositories.map(repo => repo.fullName));
    selectedRepositories = new Set();
    $('#modal-content').innerHTML = `<h2 class="modal-title">Adicionar repositórios</h2><p class="modal-copy">Selecione um ou mais repositórios. Os já adicionados e os arquivados ficam desabilitados.</p><input class="search" id="repo-search" placeholder="Buscar por nome ou descrição…"><div class="picker-summary"><span id="repository-results">${repositories.length} encontrados</span><strong id="repository-selection">0 selecionados</strong></div><div class="picker" id="repo-picker">${repositoryRows(repositories, existing)}</div><div class="modal-actions"><button class="button" value="cancel">Cancelar</button><button class="button primary" type="button" data-action="clone-selected" disabled>Adicionar selecionados</button></div>`;
    const redraw = query => {
      const normalizedQuery = normalizeSearch(query);
      const filtered = repositories.filter(repo => normalizeSearch(`${repo.fullName} ${repo.description || ''}`).includes(normalizedQuery));
      $('#repo-picker').innerHTML = repositoryRows(filtered, existing);
      $('#repository-results').textContent = `${filtered.length} encontrado${filtered.length === 1 ? '' : 's'}`;
      updateRepositorySelection();
    };
    $('#repo-search').addEventListener('input', event => redraw(event.target.value));
    $('#repo-picker').addEventListener('change', event => {
      if (!event.target.matches('input[name=repository]')) return;
      if (event.target.checked) selectedRepositories.add(event.target.value);
      else selectedRepositories.delete(event.target.value);
      updateRepositorySelection();
    });
  } catch (error) { closeModal(); toast(error.message, 'error'); }
}

function normalizeSearch(value) { return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim(); }

function repositoryRows(repositories, existing = new Set()) {
  return repositories.map(repo => {
    const unavailable = repo.archived || existing.has(repo.fullName);
    const checked = selectedRepositories.has(repo.fullName) && !unavailable;
    const label = existing.has(repo.fullName) ? 'adicionado' : repo.archived ? 'arquivado' : repo.private ? 'privado' : 'público';
    return `<label class="picker-row ${unavailable ? 'disabled' : ''}"><input type="checkbox" name="repository" value="${escapeHtml(repo.fullName)}" ${checked ? 'checked' : ''} ${unavailable ? 'disabled' : ''}><span><strong>${escapeHtml(repo.fullName)}</strong><small>${escapeHtml(repo.description || 'Sem descrição')}</small></span><span class="badge">${label}</span></label>`;
  }).join('') || '<div class="empty" style="min-height:120px">Nenhum repositório encontrado.</div>';
}

function updateRepositorySelection() {
  const count = selectedRepositories.size;
  $('#repository-selection').textContent = `${count} selecionado${count === 1 ? '' : 's'}`;
  $('[data-action="clone-selected"]').disabled = count === 0;
}

document.addEventListener('change', event => {
  if (event.target.matches('input[name=mcp-workspace]')) {
    const section = event.target.closest('.mcp-access-workspace');
    $$('input[name=mcp-repository]', section).forEach(input => { input.checked = event.target.checked; });
    updateMcpAccessSelection();
  }
  if (event.target.matches('input[name=mcp-repository]')) updateMcpAccessSelection();
});

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
    if (target.dataset.view === 'mcp-users') return renderMcpUsers();
    if (target.dataset.workspace) return renderWorkspace(target.dataset.workspace);
    if (action === 'new-workspace') return newWorkspaceModal();
    if (action === 'edit-schedule') {
      const { workspace } = await api(`/api/workspaces/${currentWorkspace}`);
      return editScheduleModal(workspace.updateSchedule);
    }
    if (action === 'save-schedule') {
      target.disabled = true;
      const cron = ['#schedule-minute','#schedule-hour','#schedule-day','#schedule-month','#schedule-weekday'].map(selector => $(selector).value.trim()).join(' ');
      await api(`/api/workspaces/${currentWorkspace}/schedule`, { method:'PUT', body:JSON.stringify({ cron, timezone:$('#schedule-timezone').value, enabled:$('#schedule-enabled').checked }) });
      closeModal(); toast('Rotina atualizada.'); return renderWorkspace(currentWorkspace);
    }
    if (action === 'toggle-schedule') {
      const { workspace } = await api(`/api/workspaces/${currentWorkspace}`);
      await api(`/api/workspaces/${currentWorkspace}/schedule`, { method:'PUT', body:JSON.stringify({ cron:workspace.updateSchedule.cron, timezone:workspace.updateSchedule.timezone, enabled:target.dataset.enabled !== 'true' }) });
      toast(target.dataset.enabled === 'true' ? 'Rotina desativada.' : 'Rotina ativada.'); return renderWorkspace(currentWorkspace);
    }
    if (action === 'run-workspace-sync') {
      await api(`/api/workspaces/${currentWorkspace}/schedule/run`, { method:'POST' });
      toast('Sincronização do workspace adicionada à fila global.'); return refreshJobs();
    }
    if (action === 'new-mcp-user') return newMcpUserModal();
    if (action === 'edit-mcp-access') {
      const user = currentMcpUsers.find(item => item.id === target.dataset.user);
      if (!user) throw new Error('Usuário MCP não encontrado. Atualize a página.');
      return editMcpAccessModal(user);
    }
    if (action === 'save-mcp-user') {
      target.disabled = true;
      const result = await api('/api/mcp-users', { method:'POST', body:JSON.stringify({ name:$('#mcp-user-name').value, identity:$('#mcp-user-identity').value, description:$('#mcp-user-description').value, repositoryIds:[...selectedMcpRepositories] }) });
      closeModal(); await renderMcpUsers(); mcpTokenModal(result.user.name, result.token); return;
    }
    if (action === 'save-mcp-access') {
      target.disabled = true;
      await api(`/api/mcp-users/${target.dataset.user}/repositories`, { method:'PUT', body:JSON.stringify({ repositoryIds:[...selectedMcpRepositories] }) });
      closeModal(); toast('Acessos atualizados.'); return renderMcpUsers();
    }
    if (action === 'copy-mcp-token') {
      const token = $('#generated-mcp-token')?.textContent?.trim() || '';
      const mode = await copyText(token);
      if (mode === 'manual') return toast('Use Ctrl+C ou Cmd+C para copiar o token selecionado.');
      target.textContent = 'Copiado ✓';
      setTimeout(() => { if (target.isConnected) target.textContent = 'Copiar token'; }, 1800);
      return toast('Token copiado.');
    }
    if (action === 'reveal-system-token') {
      const result = await api('/api/mcp-system-token/reveal', { method:'POST' }); mcpTokenModal(result.name, result.token); return;
    }
    if (action === 'rotate-system-token') {
      if (!confirm('Gerar um novo token técnico? Testes ou Playgrounds que estejam usando o token atual deixarão de funcionar imediatamente.')) return;
      const result = await api('/api/mcp-system-token/rotate', { method:'POST' }); mcpTokenModal(result.name, result.token); return;
    }
    if (action === 'reveal-workspace-token') {
      const result = await api(`/api/workspaces/${currentWorkspace}/mcp-token/reveal`, { method:'POST' });
      mcpTokenModal(result.name, result.token, true); return;
    }
    if (action === 'rotate-workspace-token') {
      if (!confirm('Gerar um novo token para este workspace? O token atual deixará de funcionar imediatamente.')) return;
      const result = await api(`/api/workspaces/${currentWorkspace}/mcp-token/rotate`, { method:'POST' });
      await renderWorkspace(currentWorkspace); mcpTokenModal(result.workspace.name, result.token, true); return;
    }
    if (action === 'revoke-workspace-token') {
      if (!confirm('Revogar o token MCP deste workspace?')) return;
      await api(`/api/workspaces/${currentWorkspace}/mcp-token/revoke`, { method:'POST' });
      toast('Token do workspace revogado.'); return renderWorkspace(currentWorkspace);
    }
    if (action === 'reactivate-workspace-token') {
      const result = await api(`/api/workspaces/${currentWorkspace}/mcp-token/reactivate`, { method:'POST' });
      await renderWorkspace(currentWorkspace); mcpTokenModal(result.workspace.name, result.token, true); return;
    }
    if (action === 'rotate-mcp-token') {
      if (!confirm(`Gerar um novo token para ${target.dataset.name}? O token atual deixará de funcionar imediatamente.`)) return;
      const result = await api(`/api/mcp-users/${target.dataset.user}/rotate`, { method:'POST' });
      await renderMcpUsers(); mcpTokenModal(result.user.name, result.token); return;
    }
    if (action === 'revoke-mcp-token') {
      if (!confirm(`Revogar o acesso de ${target.dataset.name}? O token atual deixará de funcionar imediatamente.`)) return;
      await api(`/api/mcp-users/${target.dataset.user}/revoke`, { method:'POST' }); toast('Token revogado.'); return renderMcpUsers();
    }
    if (action === 'reactivate-mcp-user') {
      if (!confirm(`Reativar ${target.dataset.name} e gerar um novo token?`)) return;
      const result = await api(`/api/mcp-users/${target.dataset.user}/reactivate`, { method:'POST' });
      await renderMcpUsers(); mcpTokenModal(result.user.name, result.token); return;
    }
    if (action === 'delete-mcp-user') {
      if (!confirm(`Excluir ${target.dataset.name}? Qualquer token ativo será revogado e o cadastro será removido.`)) return;
      await api(`/api/mcp-users/${target.dataset.user}`, { method:'DELETE' }); toast('Usuário MCP excluído.'); return renderMcpUsers();
    }
    if (action === 'open-graph-ui') { window.open(graphUrl(target.dataset.project || ''), '_blank', 'noopener,noreferrer'); return; }
    if (action === 'open-mcp-panel') { window.open(mcpPanelUrl(), '_blank', 'noopener,noreferrer'); return; }
    if (action === 'back') return renderWorkspaces();
    if (action === 'connect-github') return connectGithubModal();
    if (action === 'disconnect-github') { await api('/api/github/connection', { method:'DELETE' }); await renderGithub(); return toast('GitHub desconectado.'); }
    if (action === 'save-github') { target.disabled = true; await api('/api/github/connection', { method:'POST', body:JSON.stringify({ token:$('#github-token').value }) }); closeModal(); await renderGithub(); return toast('GitHub conectado.'); }
    if (action === 'save-workspace') { target.disabled = true; const result = await api('/api/workspaces', { method:'POST', body:JSON.stringify({ name:$('#workspace-name').value, description:$('#workspace-description').value }) }); closeModal(); await renderWorkspaces(); mcpTokenModal(result.workspace.name, result.token, true); return; }
    if (action === 'add-repositories') return repositoryPicker();
    if (action === 'clone-selected') { const selected = [...selectedRepositories]; if (!selected.length) throw new Error('Selecione pelo menos um repositório.'); target.disabled = true; await api(`/api/workspaces/${currentWorkspace}/repositories`, { method:'POST', body:JSON.stringify({ repositories:selected }) }); selectedRepositories.clear(); closeModal(); toast('Clonagem iniciada.'); await refreshJobs(); return renderWorkspace(currentWorkspace); }
    if (action === 'sync' || action === 'index') { await api(`/api/workspaces/${currentWorkspace}/repositories/${target.dataset.repo}/${action}`, { method:'POST' }); toast(action === 'sync' ? 'Sincronização iniciada.' : 'Indexação iniciada.'); return refreshJobs(); }
    if (action === 'delete-repo') { if (!confirm(`Excluir ${target.dataset.name}? O clone local será removido.`)) return; await api(`/api/workspaces/${currentWorkspace}/repositories/${target.dataset.repo}`, { method:'DELETE' }); toast('Repositório removido.'); return renderWorkspace(currentWorkspace); }
    if (action === 'delete-workspace') { if (!confirm('Excluir este workspace vazio?')) return; await api(`/api/workspaces/${currentWorkspace}`, { method:'DELETE' }); toast('Workspace removido.'); return renderWorkspaces(); }
  } catch (error) { target.disabled = false; toast(error.message, 'error'); }
});

publicConfig = await api('/api/config');
await Promise.all([renderGithub(), renderWorkspaces(), refreshJobs()]);
setInterval(refreshJobs, 3000);
