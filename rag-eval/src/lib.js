function normalized(value) {
  return String(value || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('pt-BR').replace(/\s+/g, ' ').trim();
}

function includesFact(answer, fact) {
  if (typeof fact === 'string') return normalized(answer).includes(normalized(fact));
  if (Array.isArray(fact)) return fact.some(candidate => includesFact(answer, candidate));
  throw new Error('Cada fato deve ser uma string ou uma lista de alternativas.');
}

export function validateDataset(dataset) {
  if (!dataset || !Array.isArray(dataset.cases) || !dataset.cases.length) throw new Error('O dataset deve conter ao menos um caso em cases.');
  const ids = new Set();
  for (const item of dataset.cases) {
    if (!item.id || !item.question) throw new Error('Cada caso precisa de id e question.');
    if (ids.has(item.id)) throw new Error(`ID duplicado no dataset: ${item.id}.`);
    ids.add(item.id);
    for (const field of ['requiredFacts', 'forbiddenFacts', 'expectedDocuments']) {
      if (item[field] !== undefined && !Array.isArray(item[field])) throw new Error(`${field} deve ser uma lista no caso ${item.id}.`);
    }
  }
  return dataset;
}

export function evaluateCase(testCase, result) {
  const answer = String(result.answer || '');
  const citationsText = JSON.stringify(result.citations || []);
  const requiredFacts = testCase.requiredFacts || [];
  const forbiddenFacts = testCase.forbiddenFacts || [];
  const expectedDocuments = testCase.expectedDocuments || [];
  const foundRequired = requiredFacts.filter(fact => includesFact(answer, fact));
  const foundForbidden = forbiddenFacts.filter(fact => includesFact(answer, fact));
  const foundDocuments = expectedDocuments.filter(document => normalized(citationsText).includes(normalized(document)));
  const requiresAbstention = testCase.expectAbstention === true;
  const abstained = /(nao (encontrei|ha|possuo)|sem informacao|nao consta|nao e possivel responder)/.test(normalized(answer));
  const factRecall = requiredFacts.length ? foundRequired.length / requiredFacts.length : 1;
  const citationRecall = expectedDocuments.length ? foundDocuments.length / expectedDocuments.length : 1;
  const abstentionScore = requiresAbstention ? Number(abstained) : 1;
  const passed = factRecall === 1 && foundForbidden.length === 0 && citationRecall === 1 && abstentionScore === 1;
  return {
    id: testCase.id,
    passed,
    factRecall,
    citationRecall,
    abstentionScore,
    latencyMs: result.latencyMs ?? null,
    missingRequiredFacts: requiredFacts.filter(fact => !foundRequired.includes(fact)),
    foundForbiddenFacts: foundForbidden,
    missingDocuments: expectedDocuments.filter(document => !foundDocuments.includes(document)),
    answer,
    citations: result.citations || []
  };
}

export function summarize(results) {
  const average = field => results.reduce((sum, item) => sum + item[field], 0) / Math.max(1, results.length);
  const latencies = results.map(item => item.latencyMs).filter(Number.isFinite).sort((a, b) => a - b);
  const percentile = value => latencies.length ? latencies[Math.min(latencies.length - 1, Math.ceil(latencies.length * value) - 1)] : null;
  return {
    cases: results.length,
    passed: results.filter(item => item.passed).length,
    passRate: results.filter(item => item.passed).length / Math.max(1, results.length),
    averageFactRecall: average('factRecall'),
    averageCitationRecall: average('citationRecall'),
    p50LatencyMs: percentile(0.5),
    p95LatencyMs: percentile(0.95)
  };
}

export function extractChatResult(payload, latencyMs) {
  const answer = payload?.choices?.[0]?.message?.content || payload?.message?.content || payload?.response || '';
  const citations = payload?.citations || payload?.sources || payload?.choices?.[0]?.message?.citations || [];
  return { answer, citations, latencyMs };
}
