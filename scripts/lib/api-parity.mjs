import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

export const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'TRACE']);
export const FIXTURE_ID = '00000000-0000-4000-8000-000000000911';
const parameter = /\{[^}]+\}/g;
const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function normalizePath(path) {
  return path.split(/[?#]/, 1)[0].replace(/\/{2,}/g, '/').replace(/\/$/, '').replace(parameter, '{}');
}
export function endpointKey(method, path) { return `${method.toUpperCase()} ${normalizePath(path)}`; }

export function openApiRoutes(document) {
  assert.match(document.openapi ?? '', /^3\./, 'Expected an OpenAPI 3 document');
  assert(document.paths && typeof document.paths === 'object', 'OpenAPI paths are missing');
  const routes = [];
  for (const [path, item] of Object.entries(document.paths)) {
    if (!path.startsWith('/api/v1/')) continue;
    assert(!item.$ref, `Resolve referenced path item before checking parity: ${path}`);
    for (const method of Object.keys(item)) {
      if (!HTTP_METHODS.has(method.toUpperCase())) continue;
      const expression = path.split(/(\{[^}]+\})/).map(part => part.startsWith('{') ? '[^/]+' : escapeRegex(part)).join('');
      routes.push({ key: endpointKey(method, path), method: method.toUpperCase(), path,
        matches: new RegExp(`^${expression.replace(/\/$/, '')}/?$`), specificity: path.replace(parameter, '').length });
    }
  }
  assert(routes.length, 'No /api/v1 operations found; refusing an empty parity check');
  return routes.sort((a, b) => b.specificity - a.specificity || a.key.localeCompare(b.key));
}

export function parseBaseline(text) {
  const entries = new Set();
  for (const line of text.split(/\r?\n/)) {
    const value = line.trim();
    if (!value || value.startsWith('#')) continue;
    const match = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|TRACE) (\/api\/v1\/\S+)$/.exec(value);
    assert(match, `Malformed API → MCP baseline entry: ${value}`);
    const key = endpointKey(match[1], match[2]);
    assert(!entries.has(key), `Duplicate baseline entry: ${key}`);
    entries.add(key);
  }
  return entries;
}

export function compareCoverage(routes, calls, baseline) {
  const covered = new Map();
  const unknown = new Set();
  for (const call of calls) {
    const path = call.path.split(/[?#]/, 1)[0];
    const route = routes.find(candidate => candidate.method === call.method && candidate.matches.test(path));
    if (!route) unknown.add(`${call.tool}: ${call.method} ${path}`);
    else {
      if (!covered.has(route.key)) covered.set(route.key, new Set());
      covered.get(route.key).add(call.tool);
    }
  }
  const gaps = new Set(routes.map(route => route.key).filter(key => !covered.has(key)));
  return { covered, gaps, unknown: [...unknown].sort(),
    missing: [...gaps].filter(key => !baseline.has(key)).sort(),
    stale: [...baseline].filter(key => !gaps.has(key)).sort() };
}

/** Generate valid probes from runtime JSON schemas; unsupported schemas fail visibly. */
function sample(schema, includeOptional = false, name = '') {
  if (schema.const !== undefined) return schema.const;
  if (schema.enum) return schema.enum[0];
  if (schema.default !== undefined) return schema.default;
  if (schema.anyOf || schema.oneOf) return sample((schema.anyOf ?? schema.oneOf).find(s => s.type !== 'null'), includeOptional, name);
  if (schema.type === 'object' || schema.properties) {
    return Object.fromEntries(Object.entries(schema.properties ?? {})
      .filter(([key]) => includeOptional || (schema.required ?? []).includes(key))
      .map(([key, value]) => [key, sample(value, includeOptional, key)]));
  }
  if (schema.type === 'array') return Array.from({ length: schema.minItems ?? 0 }, () => sample(schema.items, includeOptional, name));
  if (schema.type === 'boolean') return true;
  if (schema.type === 'integer' || schema.type === 'number') return Math.max(schema.minimum ?? 1, (schema.exclusiveMinimum ?? 0) + 1);
  if (schema.type === 'null') return null;
  if (schema.type === 'string') {
    if (schema.format === 'uuid') return FIXTURE_ID;
    if (schema.format === 'uri' || schema.format === 'url') return 'https://parity.example.invalid/';
    if (schema.format === 'email') return 'parity@example.invalid';
    if (name.toLowerCase().includes('domain') || name.toLowerCase().includes('hostname')) return 'parity.example.invalid';
    return 'parity'.padEnd(schema.minLength ?? 0, 'x').slice(0, schema.maxLength ?? Infinity);
  }
  // Free-form values/records occur in config overrides. The smallest valid fixture is sufficient.
  if (Object.keys(schema).every(key => ['description', 'title', 'additionalProperties'].includes(key))) return {};
  throw new Error(`Provide an explicit parity probe for unsupported schema ${name}: ${JSON.stringify(schema)}`);
}

export function probeCases(tool, overrides = {}) {
  if (overrides[tool.name]) return overrides[tool.name];
  const cases = [sample(tool.inputSchema), sample(tool.inputSchema, true)];
  // Route-changing enum arguments, such as recheck_migration_gate.action, must all be exercised.
  for (const [name, property] of Object.entries(tool.inputSchema.properties ?? {})) {
    for (const value of property.enum ?? []) cases.push({ ...sample(tool.inputSchema, true), [name]: value });
  }
  return [...new Map(cases.map(args => [JSON.stringify(args), args])).values()];
}

export const TOOL_PROBES = {
  copy_connected_project_late_changes: ['INSERT_ONLY', 'FULL_UPDATE'].map(mode => ({
    id: FIXTURE_ID, mode, expectedState: 'a'.repeat(64), confirmed: true })),
  mark_cutover_conflicts_reviewed: [{ id: FIXTURE_ID, expectedState: 'a'.repeat(64), confirmed: true }],
  // A missing template and the browser-only Firebase handoff intentionally make no API call.
  create_migration: [{ name: 'Parity fixture', templateId: FIXTURE_ID },
    { name: 'Parity fixture', templateId: FIXTURE_ID, sourceType: 'BASE44_NATIVE', sourceIntegrationInstanceId: FIXTURE_ID, base44AppId: 'parity-app' }],
  // Three mutually exclusive optional selectors dispatch to three distinct endpoints.
  get_app_secrets: [{ connectedProjectId: FIXTURE_ID }, { migrationId: FIXTURE_ID }, { stackId: FIXTURE_ID }],
  // Recovery only accepts a complete commit identity and explicit approval of that exact snapshot.
  restore_migration_source_snapshot: [{ id: FIXTURE_ID, revisionId: FIXTURE_ID, commitSha: 'a'.repeat(40), confirmed: true }],
  update_migration_source: [{ id: FIXTURE_ID, templateId: FIXTURE_ID, expectedCommitSha: 'a'.repeat(40), confirmed: true }],
  get_backend_workflows: [{ connectedProjectId: FIXTURE_ID }, { migrationId: FIXTURE_ID }],
  test_connection_credentials: [{ connectedProjectId: FIXTURE_ID, connectorId: 'calendar' },
    { migrationId: FIXTURE_ID, connectorId: 'calendar' }],
  operate_backend_workflows: ['connectedProjectId', 'migrationId'].map(key => ({ [key]: FIXTURE_ID,
    environmentId: `migration:${FIXTURE_ID}`, expectedProjectRef: 'target', action: 'DEACTIVATE',
    expectedActivated: true, expectedTickActive: true, confirmed: true })),
};

export async function collectToolCalls(createServer, probes = TOOL_PROBES) {
  let activeTool;
  const calls = [];
  const context = {
    apiFetch: async (path, options = {}) => {
      assert(activeTool, 'API request outside a tool probe');
      assert(path.startsWith('/api/v1/'), `${activeTool} called a non-V1 path: ${path}`);
      calls.push({ tool: activeTool, method: (options.method ?? 'GET').toUpperCase(), path });
      return options.responseType === 'text' ? '# Fixture report' : {};
    },
    toText: data => JSON.stringify(data),
  };
  const server = createServer(context);
  const client = new Client({ name: 'api-parity', version: '1.0.0' }, { capabilities: {} });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const tools = [];
    for (let cursor; ;) {
      const page = await client.listTools(cursor ? { cursor } : {});
      tools.push(...page.tools);
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }
    assert(tools.length, 'No runtime MCP tools discovered');
    const names = new Set(tools.map(tool => tool.name));
    for (const name of Object.keys(probes)) assert(names.has(name), `Stale parity probe for removed tool: ${name}`);
    for (const tool of tools) {
      activeTool = tool.name;
      for (const args of probeCases(tool, probes)) {
        const before = calls.length;
        const result = await client.callTool({ name: tool.name, arguments: args });
        assert.notEqual(result.isError, true,
          `${tool.name} parity probe failed; provide valid inputs: ${JSON.stringify(args)} → ${JSON.stringify(result.content)}`);
        assert(calls.length > before, `${tool.name} did not call the API for ${JSON.stringify(args)}; add a valid parity probe`);
      }
    }
    return { calls, toolCount: tools.length };
  } finally {
    await client.close();
    await server.close();
  }
}
