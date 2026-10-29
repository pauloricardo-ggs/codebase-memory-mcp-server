#!/usr/bin/env node
/**
 * Cognitive Model Router (Local Qwen / Luna / Terra / Sol)
 * GPT-6 / GPT-6.1 Generation + Local GPU Offload (RTX 5060 Ti)
 * 
 * Target Tiers:
 * - Local GPU: qwen2.5-coder:14b-instruct-q4_0 (effort: none | low)   - 80% volume, $0.00 cost, ~95 tok/s, ~48ms latency
 * - Luna:      gpt-6-luna                      (effort: none | low)   - 8% volume (fallback or large context >32k)
 * - Terra:     gpt-6.1-terra                   (effort: low | medium) - 10% volume, $0.05 cached input
 * - Sol:       gpt-6.1-sol                     (effort: medium | high)- 2% volume,  $0.10 cached input (CEILING)
 * 
 * Astra is intentionally omitted to avoid excessive cost.
 */

import http from 'node:http';
import { performance } from 'node:perf_hooks';

// Patterns for Sol (High Complexity / Concurrency / Security / Destructive Migrations)
const SOL_HIGH_PATTERNS = {
  concurrency: /\b(deadlock|race\s+condition|mutex|semaphore|thread[- ]?safe|lock\s+contention|atomic\s+operation|thread\s+starvation|concurrency\s+control|parallel\s+transaction|coroutine\s+leak)\b/i,
  security: /\b(vulnerability|cve-\d+|exploit|sql\s+injection|rce|remote\s+code\s+execution|privilege\s+escalation|authorization\s+bypass|auth\s+bypass|zero[- ]?trust|cryptographic|jwt\s+(?:tampering|signature|validation\s+flaw)|penetration\s+test|secret\s+leak)\b/i,
  destructiveDataOrContract: /\b(destructive\s+migration|irreversible\s+schema|data\s+loss\s+(?:risk|on)|public\s+api\s+breaking|breaking\s+contract|financial\s+transactions?\s+ledger)\b/i
};

// Architecture redesign at Sol tier (runs at medium effort)
const SOL_MEDIUM_PATTERNS = {
  distributedArch: /\b(distributed\s+(?:system|consensus|transaction|lock)|event\s+sourcing|cqrs|saga\s+pattern|microservice\s+decoupling|high[- ]?availability\s+architecture|paxos|raft\s+consensus|system\s+redesign|core\s+architecture)\b/i
};

// Patterns for Terra (Multi-file / Refactor / Code Review / Integration Tests)
const TERRA_PATTERNS = {
  // PR Reviews run at 'low' reasoning effort for fast, token-conserving reviews
  codeReviewLow: /\b(code\s+review|pr\s+review|pull\s+request\s+review|revisar\s+pr|revisão\s+de\s+código|review\s+diff)\b/i,
  // Multi-file implementations benefit heavily from 'medium' reasoning (SWE-bench sweet-spot)
  multiFileMedium: /\b(multi[- ]?file|across\s+multiple\s+files|vários\s+arquivos|múltiplos\s+arquivos|cross[- ]?module|integration\s+test|e2e\s+test|end[- ]?to[- ]?end|full[- ]?stack|feature\s+implementation|implement(?:ing)?\s+.*(?:flow|feature|service)|controller.*service.*repository|service.*repository|extract.*to\s+separate\s+service|refactor\s+across)\b/i
};

// Patterns for Routine / Bounded Tasks (Local GPU candidate or Luna)
const ROUTINE_PATTERNS = {
  // Purely deterministic / mechanical -> effort: "none"
  pureMechanical: {
    docs: /\b(typo|readme|docstring|documentation|comentário|ortografia|spelling|changelog|markdown)\b/i,
    formatLint: /\b(format(?:ting)?|prettier|eslint|lint(?:er)?|clean\s*up\s+imports|organize\s+imports)\b/i,
    ops: /\b(bump\s+(?:version|package)|package\.json\s+version|build\s+script|git\s+status|git\s+log|ls|list\s+files|inspect\s+log)\b/i,
    trivialEdit: /\b(rename\s+variable|renomear\s+vari[aá]vel|trocar\s+constante|update\s+constant|mudar\s+url)\b/i
  },
  // Localized logic or isolated unit tests -> effort: "low" (prevents edge case regressions)
  logicOrTest: {
    unitTest: /\b(unit\s+test|teste\s+unit[aá]rio|assert|mock\s+function|isolated\s+test)\b/i,
    singleFileBugfix: /\b(single\s+file\s+fix|localized\s+bug|handle\s+null|null\s+check|boundary\s+check|ajuste\s+condicional|corrigir\s+função)\b/i
  }
};

/**
 * Deterministic instant heuristic classifier (<1ms).
 * @param {string} text 
 * @param {object} options
 * @returns {{ provider: string, model: string, fallback_model?: string, role: string, reasoning_effort: string, cache_strategy: string, estimated_cost_usd: number, justification: string }}
 */
export function classifyHeuristic(text, options = {}) {
  const input = String(text || '').trim();
  const forceCloud = Boolean(options.forceCloud || options.cloud);

  // 1. Sol High Check (Priority 1: Concurrency, Critical Security, Destructive Data)
  const isConcurrency = SOL_HIGH_PATTERNS.concurrency.test(input);
  const isSecurity = SOL_HIGH_PATTERNS.security.test(input);
  const isDestructive = SOL_HIGH_PATTERNS.destructiveDataOrContract.test(input);

  if (isConcurrency || isSecurity || isDestructive) {
    let reason = 'High complexity critical task requiring deep chain-of-thought verification.';
    if (isSecurity) reason = 'Critical security vulnerability, authentication flaw, or cryptographic component requiring high formal reasoning.';
    else if (isConcurrency) reason = 'Concurrency, race condition, or thread-safety deadlock requiring exhaustive deep analysis.';
    else if (isDestructive) reason = 'Irreversible database migration or public contract breaking change with risk of data loss.';

    return {
      provider: 'openai',
      model: 'gpt-6.1-sol',
      role: isSecurity ? 'critical-reviewer' : 'architect',
      reasoning_effort: 'high',
      cache_strategy: 'prefix_optimized',
      estimated_cost_usd: 0.002, // $2/1M input, $10/1M output baseline
      justification: reason
    };
  }

  // 2. Sol Medium Check (Priority 2: Distributed Architecture Redesign)
  if (SOL_MEDIUM_PATTERNS.distributedArch.test(input)) {
    return {
      provider: 'openai',
      model: 'gpt-6.1-sol',
      role: 'architect',
      reasoning_effort: 'medium',
      cache_strategy: 'prefix_optimized',
      estimated_cost_usd: 0.001,
      justification: 'Distributed system architecture, consensus, or event sourcing redesign with medium reasoning effort on Sol tier.'
    };
  }

  // 3. Terra Medium Check (Priority 3: Multi-file Feature & Integration Tests - SWE-bench sweet-spot)
  if (TERRA_PATTERNS.multiFileMedium.test(input)) {
    return {
      provider: 'openai',
      model: 'gpt-6.1-terra',
      role: 'implementer',
      reasoning_effort: 'medium',
      cache_strategy: 'prefix_optimized',
      estimated_cost_usd: 0.0005,
      justification: 'Multi-file feature implementation, cross-module refactoring, or integration testing utilizing medium reasoning for benchmark excellence.'
    };
  }

  // 4. Terra Low Check (Priority 4: Code Review of PRs)
  if (TERRA_PATTERNS.codeReviewLow.test(input)) {
    return {
      provider: 'openai',
      model: 'gpt-6.1-terra',
      role: 'critical-reviewer',
      reasoning_effort: 'low',
      cache_strategy: 'prefix_optimized',
      estimated_cost_usd: 0.0002,
      justification: 'Code review of PR or diff checking logic and regressions with low reasoning effort to conserve output tokens.'
    };
  }

  // 5. Local GPU Check vs Luna Fallback (Priority 5: ~80% Routine Workload)
  // If forceCloud is requested, or context is exceptionally large (>32k), use Luna.
  const isLargeContext = Boolean(options.largeContext || input.length > 100000);
  const useLocal = !forceCloud && !isLargeContext;

  const isUnitTest = ROUTINE_PATTERNS.logicOrTest.unitTest.test(input);
  const isBugfix = ROUTINE_PATTERNS.logicOrTest.singleFileBugfix.test(input);

  if (isUnitTest || isBugfix) {
    if (useLocal) {
      return {
        provider: 'ollama',
        model: 'qwen2.5-coder:14b-instruct-q4_0',
        fallback_model: 'gpt-6-luna',
        role: 'routine-worker',
        reasoning_effort: 'low',
        cache_strategy: 'local_gpu_pinned',
        estimated_cost_usd: 0.0,
        justification: 'Isolated unit test or localized bugfix routed to local RTX 5060 Ti GPU (Qwen 2.5 Coder 14B) with zero token cost.'
      };
    }
    return {
      provider: 'openai',
      model: 'gpt-6-luna',
      role: 'routine-worker',
      reasoning_effort: 'low',
      cache_strategy: 'prefix_optimized',
      estimated_cost_usd: 0.00005,
      justification: 'Isolated unit test or localized bugfix on Luna tier utilizing low reasoning effort to avoid edge-case regressions.'
    };
  }

  // 6. Pure Mechanical / Deterministic Routine (effort: "none")
  let routineDesc = 'Deterministic routine task executed immediately without reasoning overhead.';
  if (ROUTINE_PATTERNS.pureMechanical.docs.test(input)) {
    routineDesc = 'Documentation, docstrings, or typo correction executed without reasoning overhead.';
  } else if (ROUTINE_PATTERNS.pureMechanical.formatLint.test(input)) {
    routineDesc = 'Mechanical formatting, linting, or import clean-up without reasoning overhead.';
  } else if (ROUTINE_PATTERNS.pureMechanical.ops.test(input)) {
    routineDesc = 'Routine operational, build, or terminal inspection task without reasoning overhead.';
  } else if (ROUTINE_PATTERNS.pureMechanical.trivialEdit.test(input)) {
    routineDesc = 'Trivial single-variable or constant edit without reasoning overhead.';
  }

  if (useLocal) {
    return {
      provider: 'ollama',
      model: 'qwen2.5-coder:14b-instruct-q4_0',
      fallback_model: 'gpt-6-luna',
      role: 'routine-worker',
      reasoning_effort: 'none',
      cache_strategy: 'local_gpu_pinned',
      estimated_cost_usd: 0.0,
      justification: `${routineDesc} Executed locally on RTX 5060 Ti at ~95 tok/s with zero cost.`
    };
  }

  return {
    provider: 'openai',
    model: 'gpt-6-luna',
    role: 'routine-worker',
    reasoning_effort: 'none',
    cache_strategy: 'prefix_optimized',
    estimated_cost_usd: 0.00001,
    justification: `${routineDesc} Executed on Luna with zero reasoning tokens.`
  };
}

/**
 * Query Ollama local LLM for classification with timeout.
 * @param {string} text 
 * @param {object} options 
 * @returns {Promise<{ provider: string, model: string, fallback_model?: string, role: string, reasoning_effort: string, cache_strategy: string, estimated_cost_usd: number, justification: string }>}
 */
export async function classifyWithOllama(text, options = {}) {
  const timeoutMs = options.timeoutMs || 3000;
  const modelName = options.model || process.env.OLLAMA_ROUTER_MODEL || 'qwen2.5-coder:14b-instruct-q4_0';
  const endpoint = options.endpoint || process.env.OLLAMA_ENDPOINT || 'http://localhost:11434';

  const systemPrompt = `You are an expert cognitive model router.
Available tiers:
- Local GPU ('qwen2.5-coder:14b-instruct-q4_0' via Ollama): Routine docs, formatting, single-file edits, unit tests, scripts (80% volume, zero cost). effort: 'none' or 'low'.
- Luna ('gpt-6-luna'): High-volume fallback or large context (>32k). effort: 'none' or 'low'.
- Terra ('gpt-6.1-terra'): Multi-file features, integration tests (effort: 'medium'), PR reviews (effort: 'low').
- Sol ('gpt-6.1-sol'): Concurrency, CVE/security, destructive DB migrations (effort: 'high'), core architecture (effort: 'medium'). Ceiling model. (Never use Astra).

Respond ONLY with valid JSON:
{"provider":"ollama"|"openai","model":"qwen2.5-coder:14b-instruct-q4_0"|"gpt-6-luna"|"gpt-6.1-terra"|"gpt-6.1-sol","fallback_model":"gpt-6-luna","role":"routine-worker"|"implementer"|"critical-reviewer"|"architect","reasoning_effort":"none"|"low"|"medium"|"high","cache_strategy":"local_gpu_pinned"|"prefix_optimized","estimated_cost_usd":0.0,"justification":"short explanation"}`;

  const payload = JSON.stringify({
    model: modelName,
    prompt: `${systemPrompt}\n\nTask:\n"${text.slice(0, 4000)}"\n\nJSON:`,
    stream: false,
    format: 'json',
    options: {
      temperature: 0.1,
      num_predict: 140
    }
  });

  return new Promise((resolve, reject) => {
    const url = new URL(`${endpoint}/api/generate`);
    const req = http.request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      },
      timeout: timeoutMs
    }, (res) => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        try {
          if (res.statusCode !== 200) {
            return reject(new Error(`Ollama returned status ${res.statusCode}`));
          }
          const parsedRes = JSON.parse(body);
          const responseText = parsedRes.response || '';
          const match = responseText.match(/\{[\s\S]*\}/);
          if (!match) return reject(new Error('No JSON found in Ollama response'));
          const result = JSON.parse(match[0]);

          const validModels = new Set(['qwen2.5-coder:14b-instruct-q4_0', 'gpt-6-luna', 'gpt-6.1-terra', 'gpt-6.1-sol']);
          const validRoles = new Set(['routine-worker', 'implementer', 'critical-reviewer', 'architect']);
          const validEfforts = new Set(['none', 'low', 'medium', 'high']);

          if (validModels.has(result.model) && validRoles.has(result.role) && validEfforts.has(result.reasoning_effort)) {
            resolve({
              provider: result.provider || (result.model.startsWith('gpt') ? 'openai' : 'ollama'),
              model: result.model,
              fallback_model: result.fallback_model || (result.model.startsWith('gpt') ? undefined : 'gpt-6-luna'),
              role: result.role,
              reasoning_effort: result.reasoning_effort,
              cache_strategy: result.cache_strategy || 'prefix_optimized',
              estimated_cost_usd: Number(result.estimated_cost_usd || 0.0),
              justification: String(result.justification || 'Classified via local Ollama model.').slice(0, 300)
            });
          } else {
            reject(new Error('Invalid schema from Ollama'));
          }
        } catch (err) {
          reject(err);
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Ollama request timed out'));
    });

    req.write(payload);
    req.end();
  });
}

/**
 * Main router entry point.
 * @param {string} text 
 * @param {object} options 
 * @returns {Promise<{ provider: string, model: string, fallback_model?: string, role: string, reasoning_effort: string, cache_strategy: string, estimated_cost_usd: number, justification: string }>}
 */
export async function routeTask(text, options = {}) {
  const useOllama = options.useOllama || options.ollama;

  if (useOllama) {
    try {
      return await classifyWithOllama(text, options);
    } catch {
      return classifyHeuristic(text, options);
    }
  }

  return classifyHeuristic(text, options);
}

// CLI Execution Support
async function runCLI() {
  const args = process.argv.slice(2);
  let useOllama = false;
  let forceCloud = false;
  let benchmark = false;
  let text = '';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--ollama') {
      useOllama = true;
    } else if (args[i] === '--force-cloud' || args[i] === '--cloud') {
      forceCloud = true;
    } else if (args[i] === '--benchmark') {
      benchmark = true;
    } else if (args[i] === '--task' && args[i + 1]) {
      text = args[++i];
    } else if (args[i] === '--json' && args[i + 1]) {
      try {
        const parsed = JSON.parse(args[++i]);
        text = parsed.task || parsed.text || '';
      } catch {}
    } else if (!args[i].startsWith('-')) {
      text = args[i];
    }
  }

  if (!text) {
    if (!process.stdin.isTTY) {
      const chunks = [];
      for await (const chunk of process.stdin) {
        chunks.push(chunk);
      }
      text = Buffer.concat(chunks).toString('utf-8').trim();
    }
  }

  if (!text) {
    console.error('Usage: node router.mjs [--ollama] [--force-cloud] [--benchmark] "<task description>"');
    console.error('   or: echo "<task description>" | node router.mjs');
    process.exit(1);
  }

  const start = performance.now();
  const result = await routeTask(text, { useOllama, forceCloud });
  const elapsedMs = performance.now() - start;

  if (benchmark) {
    console.log(JSON.stringify({ ...result, _benchmark_ms: Number(elapsedMs.toFixed(3)) }, null, 2));
  } else {
    console.log(JSON.stringify(result, null, 2));
  }
}

const isDirectExecution = process.argv[1] && (
  process.argv[1].endsWith('router.mjs') ||
  process.argv[1].endsWith('router')
);

if (isDirectExecution) {
  runCLI().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
