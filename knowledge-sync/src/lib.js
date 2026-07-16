import { createSign, createHash } from 'node:crypto';

export const GOOGLE_FOLDER_MIME = 'application/vnd.google-apps.folder';
export const MANAGED_ROOT = 'Google Drive (gerenciado)';
export const MIN_INTERVAL_MINUTES = 5;
export const MAX_INTERVAL_MINUTES = 10_080;

export function base64Url(value) {
  return Buffer.from(value).toString('base64url');
}

export function createServiceAccountAssertion(credentials, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!credentials?.client_email || !credentials?.private_key) throw new Error('Service Account do Google inválida.');
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64Url(JSON.stringify({
    iss: credentials.client_email,
    scope: 'https://www.googleapis.com/auth/drive.readonly',
    aud: credentials.token_uri || 'https://oauth2.googleapis.com/token',
    iat: nowSeconds,
    exp: nowSeconds + 3600
  }));
  const unsigned = `${header}.${claims}`;
  const signer = createSign('RSA-SHA256');
  signer.update(unsigned);
  signer.end();
  return `${unsigned}.${signer.sign(credentials.private_key, 'base64url')}`;
}

export function sanitizeDriveName(value, fallback = 'sem-nome') {
  const sanitized = String(value || '').replace(/[\x00-\x1f/\\]+/g, '-').replace(/\s+/g, ' ').trim();
  return (sanitized || fallback).slice(0, 180);
}

export function folderRoot(folder) {
  return `${MANAGED_ROOT}/${sanitizeDriveName(folder.name, 'pasta')}--${folder.id.slice(0, 8)}`;
}

export function fileChecksum(file) {
  if (file.md5Checksum) return `md5:${file.md5Checksum}`;
  return `meta:${createHash('sha256').update([
    file.id,
    file.modifiedTime || '',
    file.size || '',
    file.mimeType || ''
  ].join('|')).digest('hex')}`;
}

export function normalizeTargetInput(payload) {
  const knowledgeBaseId = String(payload?.knowledgeBaseId || '').trim();
  const knowledgeBaseName = String(payload?.knowledgeBaseName || '').trim().slice(0, 200);
  const enabled = payload?.enabled !== false;
  const intervalMinutes = Number.parseInt(payload?.intervalMinutes ?? '60', 10);
  if (!knowledgeBaseId || !/^[A-Za-z0-9_-]+$/.test(knowledgeBaseId)) throw new Error('Knowledge Base inválida.');
  if (!Array.isArray(payload?.folders) || payload.folders.length === 0) throw new Error('Selecione pelo menos uma pasta do Google Drive.');
  if (!Number.isInteger(intervalMinutes) || intervalMinutes < MIN_INTERVAL_MINUTES || intervalMinutes > MAX_INTERVAL_MINUTES) {
    throw new Error(`O intervalo deve ficar entre ${MIN_INTERVAL_MINUTES} e ${MAX_INTERVAL_MINUTES} minutos.`);
  }
  const seen = new Set();
  const folders = payload.folders.map(folder => {
    const id = String(folder?.id || '').trim();
    const name = sanitizeDriveName(folder?.name, 'Pasta do Drive');
    if (!id || !/^[A-Za-z0-9_-]+$/.test(id)) throw new Error('Uma das pastas selecionadas possui ID inválido.');
    if (seen.has(id)) throw new Error('A mesma pasta foi selecionada mais de uma vez.');
    seen.add(id);
    return { id, name };
  });
  return { knowledgeBaseId, knowledgeBaseName, folders, enabled, intervalMinutes };
}

export function nextRunAt(target, from = new Date()) {
  if (!target?.enabled) return null;
  if (!target.lastRunAt) return from.toISOString();
  const base = target.lastRunAt ? new Date(target.lastRunAt) : from;
  return new Date(base.getTime() + target.intervalMinutes * 60_000).toISOString();
}

export function isTargetDue(target, now = new Date()) {
  if (!target?.enabled) return false;
  if (!target.lastRunAt) return true;
  return now.getTime() >= new Date(target.lastRunAt).getTime() + target.intervalMinutes * 60_000;
}

export function publicTarget(target, running = false) {
  const { files: _files, directories: _directories, ...visible } = target;
  return {
    ...visible,
    managedFileCount: Object.keys(target.files || {}).length,
    running,
    nextRunAt: running ? null : nextRunAt(target)
  };
}
