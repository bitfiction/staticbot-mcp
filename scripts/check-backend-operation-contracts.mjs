import assert from 'node:assert/strict';
import { createServer as createHttpServer } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../dist/server/create-server.js';
import { createApiKeyContext } from '../dist/context.js';
import { createDelegatedContext } from '../dist/hosted/context.js';

const id = '00000000-0000-4000-8000-000000000921';
const templateId = '00000000-0000-4000-8000-000000000922';
const commit = 'a'.repeat(40);
const target = 'https://target.supabase.co';
const requests = [];
const fixture = createHttpServer(async (request, response) => {
  let raw = ''; for await (const chunk of request) raw += chunk;
  const body = raw ? JSON.parse(raw) : null;
  requests.push({ method: request.method, path: request.url, body, headers: request.headers });
  const reply = (status, result) => { response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(result)); };
  if (body?.expectedProjectRef === 'changed' || body?.expectedCommitSha === 'b'.repeat(40) || body?.expectedTargetSupabaseUrl === 'https://changed.supabase.co') {
    return reply(409, { message: 'Target or inspected state changed; inspect and confirm again' });
  }
  if (request.url.endsWith('/backend')) return reply(200, { environments: [{ id: `migration:${id}`, projectRef: 'target',
    stages: [{ id, title: 'App / production', live: true }], workflows: { activated: null, tickActive: null, status: 'UNAVAILABLE' },
    availableActions: ['DEFER'] }] });
  if (request.url.endsWith('/backend/workflows')) return reply(200, { outcome: 'UNVERIFIED', message: 'Inspect actual state; never retry automatically' });
  if (request.url.endsWith('/feature-branch-previews')) return reply(200, { enabled: body?.enabled ?? false, available: true, limitLabel: 'Two previews' });
  if (request.url.endsWith('/branches/preview')) return reply(202, { message: 'Queued feature/new; removed feature/old to stay within the limit' });
  if (request.url.includes('/source-update')) return request.method === 'GET'
    ? reply(200, { templateId, commitSha: commit, templateVersion: 'v2', gitRef: 'main', notice: 'New plan needs approval' })
    : reply(200, { status: 'QUEUED', message: 'Discovery will prepare a new plan for approval' });
  if (request.url.endsWith('/hosting/auth-domain')) return reply(200, { targetSupabaseUrl: target,
    authentication: { eligible: true, origin: 'https://app.example.com', status: request.method === 'GET' ? 'UPDATED' : 'READY', changedSecrets: ['APP_URL'] } });
  if (request.url.endsWith('/sync')) return reply(202, { id, status: 'IN_PROGRESS' });
  reply(404, { message: 'Unexpected route' });
});
await new Promise((resolve, reject) => { fixture.once('error', reject); fixture.listen(0, '127.0.0.1', resolve); });
const apiUrl = `http://127.0.0.1:${fixture.address().port}`;
const actor = { subject: 'workflow-user', username: 'reviewer', email: 'reviewer@example.invalid',
  oauthClientId: 'workflow-contract', scopes: ['staticbot:read', 'staticbot:write'] };
const contexts = [
  ['API-key', createApiKeyContext(apiUrl, 'workflow-api-key'), 'workflow-api-key'],
  ['OAuth', createDelegatedContext({ apiUrl }, actor, async () => 'workflow-service'), 'workflow-service'],
];
let calls = 0;
try {
  for (const [name, context, bearer] of contexts) {
    const first = requests.length;
    const server = createServer(context);
    const client = new Client({ name: `workflow-${name}`, version: '1' }, { capabilities: {} });
    const [ct, st] = InMemoryTransport.createLinkedPair(); await server.connect(st); await client.connect(ct);
    try {
      const { tools } = await client.listTools();
      const descriptor = tool => { const result = tools.find(t => t.name === tool); assert(result, tool); return result; };
      const call = async (tool, args) => { calls++; return client.callTool({ name: tool, arguments: args }); };
      const ok = async (tool, args) => { const result = await call(tool, args); assert.notEqual(result.isError, true, JSON.stringify(result)); return result.structuredContent.result; };
      const writeTools = ['operate_backend_workflows', 'set_feature_branch_preview_settings', 'build_feature_branch_preview', 'update_migration_source', 'set_external_auth_domain'];
      for (const tool of writeTools) {
        assert.equal(descriptor(tool).annotations.readOnlyHint, false);
        assert(descriptor(tool).inputSchema.required.includes('confirmed'));
      }
      for (const tool of ['get_backend_workflows', 'get_feature_branch_preview_settings', 'preview_migration_source_update', 'get_external_auth_domain']) assert.equal(descriptor(tool).annotations.readOnlyHint, true);
      assert.match(descriptor('operate_backend_workflows').description, /never retry/i);
      assert.match(descriptor('set_external_auth_domain').description, /real login/);
      assert.match(descriptor('build_feature_branch_preview').description, /removed by the plan limit/);
      assert.match(descriptor('update_migration_source').description, /separate execution approval/);
      const operation = { environmentId: `migration:${id}`, expectedProjectRef: 'target', action: 'DEFER',
        expectedActivated: null, expectedTickActive: null, confirmed: true };
      for (const selector of [{ connectedProjectId: id }, { migrationId: id }]) {
        const state = await ok('get_backend_workflows', selector);
        assert.equal(state.environments[0].workflows.activated, null);
        assert.equal(state.environments[0].stages[0].live, true);
        const path = `/api/v1/${selector.connectedProjectId ? 'connected-projects' : 'migrations'}/${id}/backend`;
        assert.equal(requests.at(-1).path, path);
        const start = requests.length;
        const result = await ok('operate_backend_workflows', { ...selector, ...operation });
        assert.equal(result.outcome, 'UNVERIFIED');
        assert.equal(requests.length, start + 1, 'Unverified operations must not be retried automatically');
        assert.equal(requests.at(-1).path, `${path}/workflows`);
        assert.deepEqual(requests.at(-1).body, operation);
      }
      const build = { id, branch: 'feature/new', expectedCommitSha: commit, expectedBuildHint: 'Removes feature/old', confirmed: true };
      const source = { id, templateId, expectedCommitSha: commit, confirmed: true };
      const auth = { id, hostname: 'app.example.com', expectedTargetSupabaseUrl: target, confirmed: true };
      const invalidStart = requests.length;
      for (const [tool, args] of [
        ['get_backend_workflows', {}], ['get_backend_workflows', { connectedProjectId: id, migrationId: id }],
        ['operate_backend_workflows', { ...operation }],
        ['operate_backend_workflows', { connectedProjectId: id, ...operation, confirmed: false }],
        ['set_feature_branch_preview_settings', { id, enabled: true }],
        ['build_feature_branch_preview', { ...build, expectedBuildHint: undefined }],
        ['build_feature_branch_preview', { ...build, confirmed: false }],
        ['update_migration_source', { ...source, expectedCommitSha: 'main' }],
        ['update_migration_source', { ...source, confirmed: undefined }],
        ['set_external_auth_domain', { ...auth, confirmed: undefined }],
        ['trigger_sync', { id, redeployAllFunctions: true }],
      ]) assert.equal((await call(tool, args)).isError, true, `${tool} invalid input`);
      assert.equal(requests.length, invalidStart, 'Invalid selectors/confirmations must not reach HTTP');
      await ok('get_feature_branch_preview_settings', { id });
      assert.equal(requests.at(-1).method, 'GET');
      await ok('set_feature_branch_preview_settings', { id, enabled: false, confirmed: true });
      assert.equal(requests.at(-1).method, 'PUT');
      assert.deepEqual(requests.at(-1).body, { enabled: false, confirmed: true });
      const built = await ok('build_feature_branch_preview', build);
      assert.match(built.message, /removed feature\/old/);
      assert.deepEqual(requests.at(-1).body, { branch: build.branch, expectedCommitSha: commit, expectedBuildHint: build.expectedBuildHint, confirmed: true });
      const planned = await ok('preview_migration_source_update', { id, templateId });
      assert.equal(planned.commitSha, commit);
      assert.equal(requests.at(-1).method, 'GET');
      assert.equal(requests.at(-1).path, `/api/v1/migrations/${id}/source-update?templateId=${templateId}`);
      const beforeUpdate = requests.length;
      await ok('update_migration_source', source);
      assert.equal(requests.length, beforeUpdate + 1, 'Source update must not automatically approve the new plan');
      assert.deepEqual(requests.at(-1).body, { templateId, expectedCommitSha: commit, confirmed: true });
      const currentAuth = await ok('get_external_auth_domain', { id });
      assert.equal(currentAuth.authentication.status, 'UPDATED');
      const queuedAuth = await ok('set_external_auth_domain', auth);
      assert.equal(queuedAuth.authentication.status, 'READY', 'Queued auth configuration is not verified login');
      assert.deepEqual(requests.at(-1).body, { hostname: auth.hostname, expectedTargetSupabaseUrl: target, confirmed: true });
      await ok('trigger_sync', { id }); assert.deepEqual(requests.at(-1).body, {});
      await ok('trigger_sync', { id, redeployAllFunctions: false }); assert.deepEqual(requests.at(-1).body, { redeployAllFunctions: false });
      await ok('trigger_sync', { id, redeployAllFunctions: true, confirmed: true });
      assert.deepEqual(requests.at(-1).body, { redeployAllFunctions: true, confirmed: true });
      for (const [tool, args] of [
        ['operate_backend_workflows', { connectedProjectId: id, ...operation, expectedProjectRef: 'changed' }],
        ['build_feature_branch_preview', { ...build, expectedCommitSha: 'b'.repeat(40) }],
        ['update_migration_source', { ...source, expectedCommitSha: 'b'.repeat(40) }],
        ['set_external_auth_domain', { ...auth, expectedTargetSupabaseUrl: 'https://changed.supabase.co' }],
      ]) {
        const before = requests.length;
        const result = await call(tool, args); assert.equal(result.isError, true);
        assert.match(JSON.stringify(result.content), /HTTP 409/);
        assert.equal(requests.length, before + 1, `${tool} must not silently choose replacement targets`);
      }
      for (const request of requests.slice(first)) {
        assert.equal(request.headers.authorization, `Bearer ${bearer}`);
        if (name === 'OAuth') assert.equal(request.headers['x-staticbot-actor-subject'], actor.subject);
      }
    } finally { await client.close(); await server.close(); }
  }
} finally { await new Promise(resolve => fixture.close(resolve)); }
console.log(`Backend operation contracts passed: ${calls} tool calls, both credentials, confirmations, stale targets and unknown outcomes`);
