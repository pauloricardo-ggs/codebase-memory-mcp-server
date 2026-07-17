import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateCase, extractChatResult, summarize, validateDataset } from '../src/lib.js';

test('avalia fatos, proibições e documentos citados', () => {
  const result = evaluateCase({ id: 'a', requiredFacts: ['30 dias'], forbiddenFacts: ['60 dias'], expectedDocuments: ['politica.pdf'] }, {
    answer: 'O prazo é de 30 dias.', citations: [{ source: { name: 'politica.pdf' } }], latencyMs: 100
  });
  assert.equal(result.passed, true);
  assert.equal(result.factRecall, 1);
  assert.equal(result.citationRecall, 1);
});

test('detecta resposta proibida e ausência de abstenção', () => {
  const result = evaluateCase({ id: 'b', forbiddenFacts: ['inventado'], expectAbstention: true }, { answer: 'O valor inventado é 10.', citations: [] });
  assert.equal(result.passed, false);
  assert.deepEqual(result.foundForbiddenFacts, ['inventado']);
  assert.equal(result.abstentionScore, 0);
});

test('valida datasets e resume resultados', () => {
  validateDataset({ cases: [{ id: 'a', question: 'A?' }] });
  assert.throws(() => validateDataset({ cases: [] }), /ao menos um caso/);
  const summary = summarize([
    { passed: true, factRecall: 1, citationRecall: 1, latencyMs: 100 },
    { passed: false, factRecall: 0, citationRecall: 0.5, latencyMs: 300 }
  ]);
  assert.equal(summary.passRate, 0.5);
  assert.equal(summary.p95LatencyMs, 300);
});

test('extrai resposta compatível com Chat Completions', () => {
  assert.deepEqual(extractChatResult({ choices: [{ message: { content: 'ok' } }], citations: [{ id: 1 }] }, 20), { answer: 'ok', citations: [{ id: 1 }], latencyMs: 20 });
});
