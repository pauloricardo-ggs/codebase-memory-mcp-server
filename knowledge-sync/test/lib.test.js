import test from 'node:test';
import assert from 'node:assert/strict';
import { fileChecksum, folderRoot, isTargetDue, normalizeTargetInput, sanitizeDriveName } from '../src/lib.js';

test('normaliza um vínculo entre pasta e Knowledge Base', () => {
  assert.deepEqual(normalizeTargetInput({
    knowledgeBaseId: 'kb_A-1',
    knowledgeBaseName: 'Base A',
    folders: [{ id: 'folder_A-1', name: 'Pasta A' }],
    intervalMinutes: 30
  }), {
    knowledgeBaseId: 'kb_A-1',
    knowledgeBaseName: 'Base A',
    folders: [{ id: 'folder_A-1', name: 'Pasta A' }],
    intervalMinutes: 30,
    enabled: true
  });
});

test('rejeita vínculo sem pastas e intervalos perigosamente curtos', () => {
  assert.throws(() => normalizeTargetInput({ knowledgeBaseId: 'kb', folders: [], intervalMinutes: 60 }), /pelo menos uma pasta/);
  assert.throws(() => normalizeTargetInput({ knowledgeBaseId: 'kb', folders: [{ id: 'folder', name: 'Pasta' }], intervalMinutes: 1 }), /entre 5 e 10080/);
});

test('cria namespace estável por pasta e sanitiza nomes', () => {
  assert.equal(sanitizeDriveName('Equipe/Financeiro\\2026'), 'Equipe-Financeiro-2026');
  assert.equal(folderRoot({ id: '1234567890abcdef', name: 'Financeiro' }), 'Google Drive (gerenciado)/Financeiro--12345678');
});

test('prefere md5 e usa metadados estáveis quando o Drive não oferece hash', () => {
  assert.equal(fileChecksum({ md5Checksum: 'abc' }), 'md5:abc');
  assert.equal(
    fileChecksum({ id: '1', modifiedTime: '2026-01-01T00:00:00Z', size: '10', mimeType: 'text/plain' }),
    fileChecksum({ id: '1', modifiedTime: '2026-01-01T00:00:00Z', size: '10', mimeType: 'text/plain' })
  );
});

test('agenda imediatamente vínculos nunca executados e respeita o intervalo depois', () => {
  const now = new Date('2026-01-01T12:00:00Z');
  assert.equal(isTargetDue({ enabled: true, intervalMinutes: 60, lastRunAt: null }, now), true);
  assert.equal(isTargetDue({ enabled: true, intervalMinutes: 60, lastRunAt: '2026-01-01T11:30:00Z' }, now), false);
  assert.equal(isTargetDue({ enabled: true, intervalMinutes: 60, lastRunAt: '2026-01-01T10:30:00Z' }, now), true);
  assert.equal(isTargetDue({ enabled: false, intervalMinutes: 60, lastRunAt: null }, now), false);
});
