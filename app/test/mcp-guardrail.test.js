import test from 'node:test';
import assert from 'node:assert/strict';
import grpc from '@grpc/grpc-js';
import protoLoader from '@grpc/proto-loader';
import path from 'node:path';
import { authorizeToolCall, filterListProjectsResult, filterToolsListResult, startMcpGuardrailServer } from '../src/mcp-guardrail.js';

const scopedAccess = { system: false, allowedProjects: new Set(['api-pedidos', 'portal-web']) };

test('guardrail permite análise somente nos projetos autorizados', () => {
  assert.equal(authorizeToolCall({ name: 'search_graph', arguments: { project: 'api-pedidos' } }, scopedAccess).allowed, true);
  assert.match(authorizeToolCall({ name: 'search_graph', arguments: { project: 'api-financeiro' } }, scopedAccess).reason, /não possui acesso/);
  assert.match(authorizeToolCall({ name: 'search_graph', arguments: {} }, scopedAccess).reason, /exige o projeto/);
});

test('guardrail bloqueia mutações, ferramentas desconhecidas e travessia cross-service', () => {
  for (const name of ['index_repository', 'delete_project', 'manage_adr', 'ingest_traces', 'future_tool']) {
    assert.equal(authorizeToolCall({ name, arguments: { project: 'api-pedidos' } }, scopedAccess).allowed, false);
  }
  assert.equal(authorizeToolCall({ name: 'trace_path', arguments: { project: 'api-pedidos', mode: 'cross_service' } }, scopedAccess).allowed, false);
  assert.equal(authorizeToolCall({ name: 'trace_path', arguments: { project: 'api-pedidos', mode: 'calls' } }, scopedAccess).allowed, true);
});

test('credencial de sistema permanece irrestrita', () => {
  assert.equal(authorizeToolCall({ name: 'delete_project', arguments: { project: 'qualquer' } }, { system: true }).allowed, true);
});

test('list_projects é filtrado no conteúdo textual e estruturado', () => {
  const payload = {
    content: [{ type: 'text', text: JSON.stringify({ projects: [{ name: 'api-pedidos' }, { name: 'api-financeiro' }] }) }],
    structuredContent: { projects: [{ name: 'api-pedidos' }, { name: 'api-financeiro' }] },
    isError: false
  };
  const filtered = filterListProjectsResult(payload, scopedAccess.allowedProjects);
  assert.deepEqual(filtered.structuredContent.projects.map(item => item.name), ['api-pedidos']);
  assert.deepEqual(JSON.parse(filtered.content[0].text).projects.map(item => item.name), ['api-pedidos']);
  const malformed = filterListProjectsResult({ content: [{ type: 'text', text: 'api-financeiro' }] }, scopedAccess.allowedProjects);
  assert.deepEqual(JSON.parse(malformed.content[0].text), { projects: [] });
});

test('tools/list não anuncia ferramentas administrativas para tokens individuais', () => {
  const filtered = filterToolsListResult({ tools: [
    { name: 'search_graph' },
    { name: 'index_repository' },
    { name: 'manage_adr' }
  ] });
  assert.deepEqual(filtered.tools.map(tool => tool.name), ['search_graph']);
});

test('servidor gRPC implementa o protocolo ExtMcp esperado pelo AgentGateway', async t => {
  const server = await startMcpGuardrailServer(userId => userId === 'user-1' ? scopedAccess : null, '127.0.0.1:0');
  t.after(() => new Promise(resolve => server.tryShutdown(resolve)));
  const protoRoot = path.resolve(import.meta.dirname, '..', 'proto');
  const definition = protoLoader.loadSync(path.join(protoRoot, 'ext_mcp.proto'), {
    includeDirs: [protoRoot],
    keepCase: false,
    longs: String,
    enums: String,
    defaults: false,
    oneofs: true
  });
  const descriptor = grpc.loadPackageDefinition(definition);
  const Client = descriptor.agentgateway.dev.ext_mcp.ExtMcp;
  const client = new Client(`127.0.0.1:${server.boundPort}`, grpc.credentials.createInsecure());
  t.after(() => client.close());

  const result = await new Promise((resolve, reject) => client.CheckRequest({
    method: 'tools/call',
    metadataContext: { fields: { userId: { stringValue: 'user-1' } } },
    mcpRequest: Buffer.from(JSON.stringify({ name: 'search_graph', arguments: { project: 'api-pedidos' } }))
  }, (error, response) => error ? reject(error) : resolve(response)));

  assert.ok(result.pass);
  assert.equal(result.metadata.fields.toolName.stringValue, 'search_graph');

  const denied = await new Promise((resolve, reject) => client.CheckRequest({
    method: 'tools/call',
    metadataContext: { fields: { userId: { stringValue: 'user-1' } } },
    mcpRequest: Buffer.from(JSON.stringify({ name: 'search_graph', arguments: { project: 'api-financeiro' } }))
  }, (error, response) => error ? reject(error) : resolve(response)));
  assert.equal(denied.error.code, 'PERMISSION_DENIED');

  const upstream = {
    content: [{ type: 'text', text: JSON.stringify({ projects: [{ name: 'api-pedidos' }, { name: 'api-financeiro' }] }) }],
    structuredContent: { projects: [{ name: 'api-pedidos' }, { name: 'api-financeiro' }] }
  };
  const filtered = await new Promise((resolve, reject) => client.CheckResponse({
    method: 'tools/call',
    metadataContext: {
      fields: {
        userId: { stringValue: 'user-1' },
        toolName: { stringValue: 'list_projects' }
      }
    },
    mcpResponse: Buffer.from(JSON.stringify(upstream))
  }, (error, response) => error ? reject(error) : resolve(response)));
  assert.deepEqual(JSON.parse(filtered.mutated).structuredContent.projects.map(item => item.name), ['api-pedidos']);
});
