import test from 'node:test';
import assert from 'node:assert/strict';
import { fileChecksum, folderRoot, isTargetDue, legacyIntervalToCron, migrateTargetSchedule, nextRunAt, normalizeTargetInput, sanitizeDriveName } from '../src/lib.js';

test('normaliza um vínculo entre pasta e Knowledge Base', () => {
  assert.deepEqual(normalizeTargetInput({
    knowledgeBaseId: 'kb_A-1',
    knowledgeBaseName: 'Base A',
    folders: [{ id: 'folder_A-1', name: 'Pasta A' }],
    cron: '30 * * * *',
    timezone: 'America/Maceio'
  }), {
    knowledgeBaseId: 'kb_A-1',
    knowledgeBaseName: 'Base A',
    folders: [{ id: 'folder_A-1', name: 'Pasta A' }],
    cron: '30 * * * *',
    timezone: 'America/Maceio',
    enabled: true
  });
});

test('rejeita vínculo sem pastas, cron inválido e fuso inválido', () => {
  assert.throws(() => normalizeTargetInput({ knowledgeBaseId: 'kb', folders: [], cron: '30 * * * *' }), /pelo menos uma pasta/);
  assert.throws(() => normalizeTargetInput({ knowledgeBaseId: 'kb', folders: [{ id: 'folder', name: 'Pasta' }], cron: 'inválido' }), /cinco campos/);
  assert.throws(() => normalizeTargetInput({ knowledgeBaseId: 'kb', folders: [{ id: 'folder', name: 'Pasta' }], cron: '30 * * * *', timezone: 'Marte/Olympus' }), /Fuso horário inválido/);
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

test('agenda pelo cron, não duplica o mesmo slot e calcula a próxima execução', () => {
  const target = { enabled: true, cron: '30 * * * *', timezone: 'UTC', createdAt: '2026-01-01T10:00:00Z' };
  assert.equal(isTargetDue(target, new Date('2026-01-01T10:29:59Z')), false);
  assert.equal(isTargetDue(target, new Date('2026-01-01T10:30:10Z')), true);
  assert.equal(isTargetDue({ ...target, lastScheduledAt: '2026-01-01T10:30:00Z' }, new Date('2026-01-01T10:30:45Z')), false);
  assert.equal(isTargetDue({ ...target, enabled: false }, new Date('2026-01-01T11:30:00Z')), false);
  assert.equal(nextRunAt(target, new Date('2026-01-01T10:31:00Z')), '2026-01-01T11:30:00.000Z');
});

test('migra intervalo legado preservando os casos comuns', () => {
  assert.equal(legacyIntervalToCron(60), '30 * * * *');
  assert.equal(legacyIntervalToCron(30), '*/30 * * * *');
  assert.equal(legacyIntervalToCron(1440), '30 0 * * *');
  const migration = migrateTargetSchedule({ intervalMinutes: 60 }, 'America/Maceio');
  assert.deepEqual(migration.target, { cron: '30 * * * *', timezone: 'America/Maceio' });
  assert.equal(migration.changed, true);
});
