import grpc from '@grpc/grpc-js';
import protoLoader from '@grpc/proto-loader';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PROTO_FILE = path.join(ROOT, 'proto', 'ext_mcp.proto');

export const MCP_ANALYSIS_TOOLS = new Set([
  'search_graph',
  'query_graph',
  'trace_path',
  'get_code_snippet',
  'get_graph_schema',
  'get_architecture',
  'search_code',
  'list_projects',
  'index_status',
  'check_index_coverage',
  'detect_changes'
]);

function valueFromProto(value) {
  if (value == null || typeof value !== 'object') return value;
  if (Object.hasOwn(value, 'stringValue')) return value.stringValue;
  if (Object.hasOwn(value, 'string_value')) return value.string_value;
  if (Object.hasOwn(value, 'numberValue')) return value.numberValue;
  if (Object.hasOwn(value, 'number_value')) return value.number_value;
  if (Object.hasOwn(value, 'boolValue')) return value.boolValue;
  if (Object.hasOwn(value, 'bool_value')) return value.bool_value;
  if (value.structValue || value.struct_value) return structFromProto(value.structValue || value.struct_value);
  const list = value.listValue || value.list_value;
  if (list) return (list.values || []).map(valueFromProto);
  return null;
}

function structFromProto(struct) {
  if (!struct) return {};
  if (!struct.fields) return struct;
  return Object.fromEntries(Object.entries(struct.fields).map(([key, value]) => [key, valueFromProto(value)]));
}

function structToProto(values) {
  return {
    fields: Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { stringValue: String(value) }]))
  };
}

function parseJsonBuffer(buffer, label) {
  try { return JSON.parse(Buffer.from(buffer || []).toString('utf8')); }
  catch { throw new Error(`${label} não contém JSON válido.`); }
}

function permissionDenied(reason) {
  return { error: { code: 'PERMISSION_DENIED', reason } };
}

function invalidRequest(reason) {
  return { error: { code: 'INVALID', reason } };
}

function projectEntries(result) {
  return Array.isArray(result?.projects) ? result.projects : null;
}

function filterProjectPayload(payload, allowedProjects) {
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.projects)) return payload;
  return {
    ...payload,
    projects: payload.projects.filter(item => {
      const name = typeof item === 'string' ? item : item?.name || item?.project;
      return allowedProjects.has(name);
    })
  };
}

export function filterListProjectsResult(result, allowedProjects) {
  const filtered = structuredClone(result);
  if (filtered.structuredContent) {
    filtered.structuredContent = projectEntries(filtered.structuredContent)
      ? filterProjectPayload(filtered.structuredContent, allowedProjects)
      : { projects: [] };
  }
  if (Array.isArray(filtered.content)) {
    filtered.content = filtered.content.map(item => {
      if (item?.type !== 'text' || typeof item.text !== 'string') return item;
      try {
        const parsed = JSON.parse(item.text);
        if (!projectEntries(parsed)) return { ...item, text: JSON.stringify({ projects: [] }) };
        return { ...item, text: JSON.stringify(filterProjectPayload(parsed, allowedProjects)) };
      } catch { return { ...item, text: JSON.stringify({ projects: [] }) }; }
    });
  }
  return filterProjectPayload(filtered, allowedProjects);
}

export function filterToolsListResult(result) {
  if (!Array.isArray(result?.tools)) return result;
  return { ...result, tools: result.tools.filter(tool => MCP_ANALYSIS_TOOLS.has(tool?.name)) };
}

export function authorizeToolCall(params, access) {
  if (access?.system === true) return { allowed: true, toolName: params?.name };
  if (!access) return { allowed: false, reason: 'Credencial sem cadastro de acesso MCP.' };

  const toolName = String(params?.name || '');
  const args = params?.arguments && typeof params.arguments === 'object' ? params.arguments : {};
  if (!MCP_ANALYSIS_TOOLS.has(toolName)) {
    return { allowed: false, reason: `A ferramenta ${toolName || 'informada'} não está disponível para tokens individuais.` };
  }
  if (toolName === 'list_projects') return { allowed: true, toolName };
  if (toolName === 'trace_path' && args.mode === 'cross_service') {
    return { allowed: false, reason: 'trace_path em modo cross_service pode atravessar repositórios e exige a credencial de sistema.' };
  }
  const project = typeof args.project === 'string' ? args.project : '';
  if (!project) return { allowed: false, reason: `A ferramenta ${toolName} exige o projeto do repositório.` };
  if (!access.allowedProjects.has(project)) {
    return { allowed: false, reason: `O usuário não possui acesso ao repositório do projeto ${project}.` };
  }
  return { allowed: true, toolName };
}

export function createMcpGuardrailHandlers(resolveAccess) {
  return {
    checkRequest(call, callback) {
      try {
        const metadata = structFromProto(call.request.metadataContext || call.request.metadata_context);
        const userId = String(metadata.userId || '');
        if (call.request.method !== 'tools/call') return callback(null, { pass: {} });
        const params = parseJsonBuffer(call.request.mcpRequest || call.request.mcp_request, 'A chamada MCP');
        const decision = authorizeToolCall(params, resolveAccess(userId));
        if (!decision.allowed) return callback(null, permissionDenied(decision.reason));
        callback(null, { pass: {}, metadata: structToProto({ toolName: decision.toolName || '' }) });
      } catch (error) {
        callback(null, invalidRequest(error.message));
      }
    },

    checkResponse(call, callback) {
      try {
        const metadata = structFromProto(call.request.metadataContext || call.request.metadata_context);
        const access = resolveAccess(String(metadata.userId || ''));
        if (access?.system === true) return callback(null, { pass: {} });
        if (!access) return callback(null, permissionDenied('Credencial sem cadastro de acesso MCP.'));

        const result = parseJsonBuffer(call.request.mcpResponse || call.request.mcp_response, 'A resposta MCP');
        if (call.request.method === 'tools/list') {
          return callback(null, { mutated: Buffer.from(JSON.stringify(filterToolsListResult(result))) });
        }
        const toolName = String(metadata.toolName || '');
        const hasProjects = projectEntries(result?.structuredContent)
          || result?.content?.some(item => {
            if (item?.type !== 'text' || typeof item.text !== 'string') return false;
            try { return Boolean(projectEntries(JSON.parse(item.text))); } catch { return false; }
          });
        if (toolName === 'list_projects' || hasProjects) {
          const filtered = filterListProjectsResult(result, access.allowedProjects);
          return callback(null, { mutated: Buffer.from(JSON.stringify(filtered)) });
        }
        callback(null, { pass: {} });
      } catch (error) {
        callback(null, invalidRequest(error.message));
      }
    }
  };
}

export async function startMcpGuardrailServer(resolveAccess, address = '0.0.0.0:3001') {
  const definition = protoLoader.loadSync(PROTO_FILE, {
    includeDirs: [path.join(ROOT, 'proto')],
    keepCase: false,
    longs: String,
    enums: String,
    defaults: false,
    oneofs: true
  });
  const descriptor = grpc.loadPackageDefinition(definition);
  const service = descriptor.agentgateway.dev.ext_mcp.ExtMcp.service;
  const handlers = createMcpGuardrailHandlers(resolveAccess);
  const server = new grpc.Server();
  server.addService(service, {
    CheckRequest: handlers.checkRequest,
    CheckResponse: handlers.checkResponse
  });
  server.boundPort = await new Promise((resolve, reject) => {
    server.bindAsync(address, grpc.ServerCredentials.createInsecure(), (error, port) => {
      if (error) reject(error);
      else if (!port) reject(new Error(`Não foi possível abrir o guardrail MCP em ${address}.`));
      else resolve(port);
    });
  });
  return server;
}
