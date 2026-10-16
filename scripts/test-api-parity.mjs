import assert from 'node:assert/strict';
import { test } from 'node:test';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { collectToolCalls, compareCoverage, openApiRoutes, parseBaseline } from './lib/api-parity.mjs';

const spec = paths => ({ openapi: '3.0.3', paths });
const inventory = openApiRoutes(spec({ '/api/v1/items/{id}/run': { post: {} }, '/api/v1/items': { get: {} } }));
const call = { tool: 'read', method: 'GET', path: '/api/v1/items?limit=10' };

test('new API operation or removed MCP coverage fails; parameter names and queries do not hide a gap', () => {
  assert.deepEqual(compareCoverage(inventory, [call], new Set()).missing, ['POST /api/v1/items/{}/run']);
  const covered = [call, { tool: 'run', method: 'POST', path: '/api/v1/items/encoded%20id/run?mode=one' }];
  assert.deepEqual(compareCoverage(inventory, covered, new Set()).missing, []);
  assert.equal(compareCoverage(inventory, [], new Set()).missing.length, 2);
});
test('wrong HTTP method and literal suffix produce unknown calls', () => {
  const result = compareCoverage(inventory, [{ ...call, method: 'POST' }, { ...call, path: '/api/v1/items/abc/running' }], new Set());
  assert.equal(result.unknown.length, 2);
  assert.equal(result.missing.length, 2);
});
test('closing or removing a deferred route forces baseline cleanup', () => {
  const baseline = parseBaseline('GET /api/v1/items\nPOST /api/v1/items/{itemId}/run\n');
  assert.deepEqual(compareCoverage(inventory, [call], baseline).stale, ['GET /api/v1/items']);
  assert.throws(() => parseBaseline('GET /api/v1/items/{id}\nGET /api/v1/items/{other}\n'), /Duplicate/);
  assert.throws(() => parseBaseline('not a route'), /Malformed/);
});
test('empty or unresolved OpenAPI contracts fail instead of reporting parity', () => {
  assert.throws(() => openApiRoutes(spec({})), /No \/api\/v1/);
  assert.throws(() => openApiRoutes(spec({ '/api/v1/items': { $ref: '#/components/pathItems/items' } })), /referenced/);
});
test('runtime dispatch probes every enum value and records the handler actual HTTP methods', async () => {
  const { calls, toolCount } = await collectToolCalls(context => {
    const server = new McpServer({ name: 'parity-fixture', version: '1.0.0' });
    server.registerTool('dispatch', { inputSchema: { action: z.enum(['build', 'destroy']), id: z.string().uuid() } },
      async ({ action, id }) => {
        await context.apiFetch(`/api/v1/items/${id}/${action}`, { method: 'POST' });
        return { content: [{ type: 'text', text: 'fixture' }] };
      });
    return server;
  }, {});
  assert.equal(toolCount, 1);
  assert.deepEqual(new Set(calls.map(call => call.path.split('/').at(-1))), new Set(['build', 'destroy']));
  assert(calls.every(call => call.method === 'POST'));
});

// Exercise the actual CLI and production registry too, so a comparison-helper test alone cannot
// pass while npm test accidentally stops loading the current inventory or handler calls.
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

function runChangedContract(change) {
  const directory = mkdtempSync(join(tmpdir(), 'staticbot-api-parity-'));
  try {
    const document = JSON.parse(readFileSync(new URL('../contracts/app-v1-openapi.json', import.meta.url), 'utf8'));
    change(document);
    const path = join(directory, 'openapi.json');
    writeFileSync(path, JSON.stringify(document));
    const child = spawnSync(process.execPath, [fileURLToPath(new URL('./check-api-parity.mjs', import.meta.url)), '--openapi', path],
      { encoding: 'utf8', timeout: 10000 });
    assert.ifError(child.error);
    assert.equal(child.status, 1, child.stdout + child.stderr);
    return child.stderr;
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

test('CLI fails when the app adds a route that no real MCP tool calls', () => {
  const error = runChangedContract(document => {
    document.paths['/api/v1/parity-regression-probe'] = { get: { responses: { default: { description: 'Fixture' } } } };
  });
  assert.match(error, /GET \/api\/v1\/parity-regression-probe/);
  assert.doesNotMatch(error, /Tools call routes\/methods absent/);
});

test('CLI fails when a real MCP tool still calls a removed API method', () => {
  const error = runChangedContract(document => { delete document.paths['/api/v1/templates'].get; });
  assert.match(error, /list_templates: GET \/api\/v1\/templates/);
});
