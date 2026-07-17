import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { JOB_HISTORY_RETENTION_MS, loadJobHistory, paginateJobs, pruneJobHistory, recoverInterruptedJobs, saveJobHistory } from '../src/job-history.js';

test('histórico mantém somente operações concluídas nos últimos sete dias e operações ativas', () => {
  const now = Date.parse('2026-07-17T12:00:00.000Z');
  const jobs = [
    { id: 'recent', status: 'completed', finishedAt: new Date(now - JOB_HISTORY_RETENTION_MS + 1).toISOString() },
    { id: 'expired', status: 'failed', finishedAt: new Date(now - JOB_HISTORY_RETENTION_MS - 1).toISOString() },
    { id: 'running', status: 'running', createdAt: new Date(now - JOB_HISTORY_RETENTION_MS * 2).toISOString() }
  ];

  assert.deepEqual(pruneJobHistory(jobs, { now }).map(job => job.id), ['recent', 'running']);
});

test('recuperação marca operações em andamento como interrompidas', () => {
  const now = new Date('2026-07-17T12:00:00.000Z');
  const result = recoverInterruptedJobs([
    { id: 'running', status: 'running', log: 'iniciada' },
    { id: 'queued', status: 'queued', log: '' },
    { id: 'completed', status: 'completed', log: 'ok' }
  ], { now });

  assert.equal(result.changed, true);
  assert.equal(result.jobs[0].status, 'interrupted');
  assert.match(result.jobs[0].log, /reinicialização/);
  assert.equal(result.jobs[0].finishedAt, now.toISOString());
  assert.equal(result.jobs[1].status, 'interrupted');
  assert.equal(result.jobs[2].status, 'completed');
});

test('paginação limita o tamanho e ajusta páginas fora do intervalo', () => {
  const jobs = Array.from({ length: 23 }, (_, index) => ({ id: String(index + 1) }));
  const second = paginateJobs(jobs, { page: 2, pageSize: 10 });
  assert.deepEqual(second.jobs.map(job => job.id), ['11', '12', '13', '14', '15', '16', '17', '18', '19', '20']);
  assert.deepEqual(second.pagination, { page: 2, pageSize: 10, total: 23, totalPages: 3 });

  const clamped = paginateJobs(jobs, { page: 99, pageSize: 10 });
  assert.equal(clamped.pagination.page, 3);
  assert.deepEqual(clamped.jobs.map(job => job.id), ['21', '22', '23']);
});

test('histórico é salvo atomicamente com permissão restrita', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'cbm-job-history-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'jobs.json');
  const jobs = [{ id: 'job-1', status: 'completed' }];

  await saveJobHistory(file, jobs);

  assert.deepEqual(await loadJobHistory(file), jobs);
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { version: 1, jobs });
  if (process.platform !== 'win32') assert.equal((await stat(file)).mode & 0o777, 0o600);
});
