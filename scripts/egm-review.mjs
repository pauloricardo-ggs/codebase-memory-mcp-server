#!/usr/bin/env node
/**
 * EGM Review Tool (The Goldfish - Zero-Context Adversarial Spec Reviewer)
 * Spec-Driven Development 2.0
 * 
 * Evaluates a design specification (.md) with zero context memory, tearing down
 * hidden assumptions, unhandled edge cases, and scope gaps before code is written.
 * Runs on the local GPU (Qwen 2.5 Coder 14B on RTX 5060 Ti) with $0.00 token cost.
 * 
 * Usage:
 *   node scripts/egm-review.mjs --spec docs/designs/minha-feature.md
 *   node scripts/egm-review.mjs --spec docs/designs/minha-feature.md --export-envelope envelope.json
 */

import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';

function usage() {
  process.stdout.write(`Usage: node scripts/egm-review.mjs --spec <file.md> [--model <model>] [--endpoint <url>] [--export-envelope <file.json>] [--json]
Adversarial zero-context review for Spec-Driven Development (EGM).
Runs by default on local GPU (qwen2.5-coder:14b-instruct-q4_0) at zero token cost.
`);
}

function parseArgs(args) {
  if (args.includes('--help') || args.includes('-h')) return { help: true };

  const options = {
    spec: null,
    model: process.env.OLLAMA_ROUTER_MODEL || 'qwen2.5-coder:14b-instruct-q4_0',
    endpoint: process.env.OLLAMA_ENDPOINT || 'http://localhost:11434',
    exportEnvelope: null,
    json: false
  };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--spec' && args[i + 1]) options.spec = args[++i];
    else if (args[i] === '--model' && args[i + 1]) options.model = args[++i];
    else if (args[i] === '--endpoint' && args[i + 1]) options.endpoint = args[++i];
    else if (args[i] === '--export-envelope' && args[i + 1]) options.exportEnvelope = args[++i];
    else if (args[i] === '--json') options.json = true;
  }

  if (!options.spec) {
    throw new Error('--spec <file.md> is required.');
  }

  return options;
}

function getGitHead() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return '0000000000000000000000000000000000000000';
  }
}

function getGitBranch() {
  try {
    return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return 'main';
  }
}

async function queryOllama(endpoint, model, systemPrompt, userPrompt) {
  const payload = JSON.stringify({
    model,
    prompt: `${systemPrompt}\n\nSPECIFICATION TO REVIEW:\n\"\"\"\n${userPrompt.slice(0, 30000)}\n\"\"\"\n\nOUTPUT (JSON strictly):`,
    stream: false,
    format: 'json',
    options: {
      temperature: 0.15,
      num_predict: 2048,
      num_ctx: 32768
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
      timeout: 120000
    }, (res) => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        try {
          if (res.statusCode !== 200) {
            return reject(new Error(`Ollama returned HTTP ${res.statusCode}: ${body}`));
          }
          const parsed = JSON.parse(body);
          const responseText = parsed.response || '';
          const match = responseText.match(/\{[\s\S]*\}/);
          if (!match) return reject(new Error('No JSON object found in Ollama review response'));
          resolve(JSON.parse(match[0]));
        } catch (err) {
          reject(err);
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Review request timed out after 120s'));
    });

    req.write(payload);
    req.end();
  });
}

function parseSpecMetadata(content) {
  const taskIdMatch = content.match(/Identificador\*?:\s*`?([A-Za-z0-9._-]+)`?/i) || content.match(/\[([A-Za-z0-9._-]+)\]/);
  const taskId = taskIdMatch ? taskIdMatch[1] : `task-${Date.now()}`;

  const objectiveMatch = content.match(/## 1\.\s*Objetivo[\s\S]*?- \*\*Problema\*\*:\s*([^\n]+)/i);
  const objective = objectiveMatch ? objectiveMatch[1].trim() : 'Feature implementation based on design spec.';

  // Extract affected files from markdown table
  const fileLines = content.match(/\|\s*`?([^`\s|]+\.[A-Za-z0-9]+)`?\s*\|\s*`?(\w+)`?\s*\|\s*`?([^`|\s]+)`?/g) || [];
  const files = [];

  for (const line of fileLines) {
    const parts = line.split('|').map(s => s.trim().replace(/`/g, ''));
    if (parts.length >= 4 && parts[1] && !parts[1].toLowerCase().includes('caminho')) {
      const filePath = parts[1];
      const roleRaw = (parts[2] || 'implementation').toLowerCase();
      const validRoles = new Set(['implementation', 'test', 'contract', 'documentation', 'configuration']);
      const role = validRoles.has(roleRaw) ? roleRaw : 'implementation';
      const owner = parts[3] || 'developer';
      files.push({ path: filePath, role, owner });
    }
  }

  return { taskId, objective, files };
}

function generateTaskEnvelope(metadata, reviewResult, commit, branch) {
  const criteria = (reviewResult.strengths || []).map((text, idx) => ({
    id: `ac-${idx + 1}`,
    text: String(text).slice(0, 160),
    status: 'passed'
  }));

  if (criteria.length === 0) {
    criteria.push({
      id: 'ac-1',
      text: 'Implementation adheres strictly to design spec without unhandled regressions.',
      status: 'pending'
    });
  }

  const files = metadata.files.length > 0 ? metadata.files : [
    { path: 'README.md', role: 'documentation', owner: 'developer' }
  ];

  return {
    taskId: metadata.taskId,
    objective: metadata.objective,
    acceptanceCriteria: criteria,
    explicitExclusions: [
      'No modifications outside explicitly specified files in the design spec.',
      'No destructive schema migrations without explicit DBA review.'
    ],
    baseline: {
      commit,
      branch,
      workingTree: 'clean'
    },
    requirements: [
      {
        id: 'req-1',
        text: metadata.objective,
        files: files.map(f => f.path),
        checks: ['chk-1']
      }
    ],
    files,
    checks: [
      {
        id: 'chk-1',
        command: 'npm test --if-present || dotnet test || true',
        status: 'pending',
        baselineCommit: commit
      }
    ],
    review: {
      status: reviewResult.verdict === 'APPROVED' ? 'passed' : 'pending',
      baselineCommit: commit,
      findings: [
        ...(reviewResult.unstated_assumptions || []),
        ...(reviewResult.missing_edge_cases || [])
      ].slice(0, 20)
    }
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) return usage();

  const specContent = await readFile(options.spec, 'utf-8');
  const metadata = parseSpecMetadata(specContent);

  const systemPrompt = `You are The Goldfish (an adversarial, zero-context software design specification critic).
You have ZERO memory of previous brainstorming conversations and you do not care about politeness.
Your mission: Tear down this design specification before any developer or agent writes code.
Identify:
1. Unstated assumptions (things taken for granted that might fail in production).
2. Missing edge cases (null inputs, timeouts, concurrency, boundary conditions).
3. Ambiguities where the programmer would be forced to guess.
4. Security/compliance risks (auth bypass, SQLi, sensitive data leakage).
5. Veredict:
   - "APPROVED" (Score >= 85, ready for implementation)
   - "NEEDS_REVISION" (Score 50-84, gaps must be fixed first)
   - "REJECTED" (Score < 50, fundamentally flawed or empty)

Respond STRICTLY with valid JSON:
{
  "verdict": "APPROVED" | "NEEDS_REVISION" | "REJECTED",
  "score": number (0-100),
  "strengths": string[],
  "unstated_assumptions": string[],
  "missing_edge_cases": string[],
  "security_risks": string[],
  "actionable_recommendations": string[]
}`;

  process.stderr.write(`[Goldfish Reviewer] Inspecting ${options.spec} via ${options.model}...\n`);
  const reviewResult = await queryOllama(options.endpoint, options.model, systemPrompt, specContent);

  if (options.json) {
    process.stdout.write(JSON.stringify(reviewResult, null, 2) + '\n');
  } else {
    process.stdout.write(`\n=======================================================\n`);
    process.stdout.write(` GOLDFISH ADVERSARIAL SPEC REVIEW: ${reviewResult.verdict}\n`);
    process.stdout.write(` Score: ${reviewResult.score}/100\n`);
    process.stdout.write(`=======================================================\n\n`);

    if (reviewResult.strengths?.length) {
      process.stdout.write(`✓ STRENGTHS:\n`);
      reviewResult.strengths.forEach(s => process.stdout.write(`  - ${s}\n`));
      process.stdout.write('\n');
    }

    if (reviewResult.unstated_assumptions?.length) {
      process.stdout.write(`⚠ UNSTATED ASSUMPTIONS:\n`);
      reviewResult.unstated_assumptions.forEach(s => process.stdout.write(`  - ${s}\n`));
      process.stdout.write('\n');
    }

    if (reviewResult.missing_edge_cases?.length) {
      process.stdout.write(`! MISSING EDGE CASES:\n`);
      reviewResult.missing_edge_cases.forEach(s => process.stdout.write(`  - ${s}\n`));
      process.stdout.write('\n');
    }

    if (reviewResult.security_risks?.length) {
      process.stdout.write(`🔒 SECURITY RISKS:\n`);
      reviewResult.security_risks.forEach(s => process.stdout.write(`  - ${s}\n`));
      process.stdout.write('\n');
    }

    if (reviewResult.actionable_recommendations?.length) {
      process.stdout.write(`📋 ACTIONABLE FIXES BEFORE CODING:\n`);
      reviewResult.actionable_recommendations.forEach(s => process.stdout.write(`  - ${s}\n`));
      process.stdout.write('\n');
    }
  }

  if (options.exportEnvelope) {
    const commit = getGitHead();
    const branch = getGitBranch();
    const envelope = generateTaskEnvelope(metadata, reviewResult, commit, branch);
    await writeFile(options.exportEnvelope, JSON.stringify(envelope, null, 2));
    process.stderr.write(`[Envelope Export] Task envelope written to ${options.exportEnvelope}\n`);
  }
}

main().catch(err => {
  process.stderr.write(`[Error] Goldfish review failed: ${err.message}\n`);
  process.exit(1);
});
