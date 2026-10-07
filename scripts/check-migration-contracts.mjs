import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createServer as createHttpServer } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { createApiKeyContext } from "../dist/context.js";
import { createDelegatedContext } from "../dist/hosted/context.js";
import { createServer } from "../dist/server/create-server.js";

// Exercise actual tool validation, dispatch and HTTP decoding with both authentication contexts.
// Local fixtures verify the adapter contract, not live source access or production OAuth setup.
const migrationId = "00000000-0000-4000-8000-000000000101";
const lockedId = "00000000-0000-4000-8000-000000000102";
const revisionId = "00000000-0000-4000-8000-000000000103";
const missingRevisionId = "00000000-0000-4000-8000-000000000104";
const staleRevisionId = "00000000-0000-4000-8000-000000000105";
const templateId = "00000000-0000-4000-8000-000000000106";
const sourceIntegrationId = "00000000-0000-4000-8000-000000000107";
const targetIntegrationId = "00000000-0000-4000-8000-000000000108";
const rootPath = `/api/v1/migrations/${migrationId}`;
const lockMessage = "Execution contract is no longer supported. Create a new migration.";
const report = "# Migration handoff\n\nREPORT_BODY_ONLY_8d1fb4\n\n## Activate migrated schedules\n\n```sql\nbegin;\n-- Guarded activation artifact supplied by the backend\ncommit;\n```\n";
const revision = { revisionId, revisionNumber: 3, approvedAt: null, readOnly: true, report: { findings: [] } };
const requests = [];
const apiServer = createHttpServer(async (request, response) => {
  let body = "";
  for await (const chunk of request) body += chunk;
  requests.push({ method: request.method, url: request.url, headers: request.headers, body });
  const url = new URL(request.url, "http://localhost");
  const json = (status, payload) => {
    response.writeHead(status, { "Content-Type": "application/json" });
    response.end(JSON.stringify(payload));
  };
  if (url.pathname.endsWith("/handoff-report") && request.headers.accept !== "text/markdown") {
    return json(406, { message: "The handoff endpoint produces text/markdown." });
  }
  if (url.pathname.startsWith(`/api/v1/migrations/${lockedId}`)) {
    if (request.method !== "GET") return json(400, { message: lockMessage });
    if (url.pathname.endsWith("/handoff-report")) {
      response.writeHead(200, { "Content-Type": "text/markdown;charset=UTF-8" });
      return response.end(report);
    }
    return json(200, { status: "IN_PROGRESS", pendingAction: null,
      executionCompatibility: { locked: true, message: lockMessage }, blockedReason: lockMessage });
  }
  if (url.pathname === `${rootPath}/source-inspection`) {
    response.writeHead(202);
    return response.end();
  }
  if (url.pathname === `${rootPath}/discovery-report/revisions`) {
    return json(200, [{ revisionId, revisionNumber: 3, approvedAt: null, active: true }]);
  }
  if (url.pathname === `${rootPath}/discovery-report/revisions/${missingRevisionId}` ||
      url.searchParams.get("revisionId") === missingRevisionId) {
    return json(404, { message: "Saved discovery report is not available." });
  }
  if (url.pathname === `${rootPath}/discovery-report/revisions/${revisionId}`) return json(200, revision);
  if (url.pathname === `${rootPath}/handoff-report`) {
    response.writeHead(200, { "Content-Type": "text/markdown;charset=UTF-8" });
    return response.end(report);
  }
  if (url.pathname === `${rootPath}/confirm`) {
    if (body.includes(staleRevisionId)) return json(409, { message: "Discovery changed. Review the new revision." });
    response.writeHead(204);
    return response.end();
  }
  if (url.pathname === "/malformed-json") {
    response.writeHead(200, { "Content-Type": "application/json" });
    return response.end("not-json");
  }
  if (url.pathname === "/empty-text") {
    response.writeHead(200, { "Content-Type": "text/markdown" });
    return response.end();
  }
  if (url.pathname === "/api/v1/migrations" && request.method === "POST") {
    return json(200, { id: migrationId });
  }
  json(200, { revisionId, sourceInspection: { supported: true, available: true, inProgress: false, reason: null } });
});
await new Promise((resolve, reject) => {
  apiServer.once("error", reject);
  apiServer.listen(0, "127.0.0.1", resolve);
});
const apiUrl = `http://127.0.0.1:${apiServer.address().port}`;
const actor = { subject: "test-subject", username: "test-user", email: "test@example.invalid",
  oauthClientId: "migration-contract-client", scopes: ["staticbot:read", "staticbot:write"], identityProvider: "test-idp" };
const contexts = [
  { name: "API-key", context: createApiKeyContext(apiUrl, "contract-api-key"), bearer: "contract-api-key" },
  { name: "delegated OAuth", context: createDelegatedContext({ apiUrl }, actor, async () => "contract-service-token"),
    bearer: "contract-service-token" },
];

const realWrite = process.stderr.write;
let logs = "";
process.stderr.write = (chunk) => { logs += String(chunk); return true; };
let calls = 0;
try {
  for (const { name, context, bearer } of contexts) {
    const firstRequest = requests.length;
    const server = createServer(context);
    const client = new Client({ name: `migration-contract-${name}`, version: "1.0.0" }, { capabilities: {} });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    try {
      await client.connect(clientTransport);
      const { tools } = await client.listTools();
      const descriptor = (toolName) => {
        const tool = tools.find(tool => tool.name === toolName);
        assert(tool, `${name}: ${toolName} must be registered`);
        return tool;
      };
      const call = async (toolName, args) => {
        calls++;
        return client.callTool({ name: toolName, arguments: args });
      };
      const ok = async (toolName, args) => {
        const result = await call(toolName, args);
        assert.notEqual(result.isError, true, `${name}: ${toolName}: ${JSON.stringify(result.content)}`);
        return result;
      };
      for (const toolName of ["list_migration_discovery_revisions", "get_migration_discovery_revision", "get_migration_handoff_report"]) {
        assert.equal(descriptor(toolName).annotations.readOnlyHint, true);
      }
      assert.equal(descriptor("inspect_migration_source").annotations.readOnlyHint, false);
      assert(descriptor("inspect_migration_source").inputSchema.required.includes("authorizeHelperDeployment"));
      assert.match(descriptor("get_migration").description, /executionCompatibility\.locked/);
      assert.match(descriptor("create_migration").description, /never borrow the target integration/i);

      const beforeInvalid = requests.length;
      for (const args of [{ id: migrationId }, { id: migrationId, authorizeHelperDeployment: false },
        { id: migrationId, authorizeHelperDeployment: "true" }]) {
        assert.equal((await call("inspect_migration_source", args)).isError, true);
      }
      for (const args of [{ id: migrationId, beforeRevision: 0 }, { id: migrationId, limit: 101 },
        { id: migrationId, limit: 0 }, { id: migrationId, beforeRevision: 1.5 }]) {
        assert.equal((await call("list_migration_discovery_revisions", args)).isError, true);
      }
      assert.equal((await call("get_migration_discovery_revision", { id: migrationId, revisionId: "bad" })).isError, true);
      assert.equal((await call("get_migration_handoff_report", { id: migrationId, revisionId: "bad" })).isError, true);
      assert.equal(requests.length, beforeInvalid, `${name}: invalid authorization/cursors/IDs must never reach the API`);

      const queued = await ok("inspect_migration_source", { id: migrationId, authorizeHelperDeployment: true });
      assert.deepEqual(queued.structuredContent.result, { queued: true, migrationId });
      assert.equal(requests.at(-1).url, `${rootPath}/source-inspection`);
      assert.equal(requests.at(-1).method, "POST");
      assert.deepEqual(JSON.parse(requests.at(-1).body), { authorizeHelperDeployment: true });

      await ok("get_migration_discovery_report", { id: migrationId });
      assert.equal(requests.at(-1).url, `${rootPath}/discovery-report`);
      assert.equal(requests.at(-1).method, "GET");
      const page = await ok("list_migration_discovery_revisions", { id: migrationId, beforeRevision: 4, limit: 1 });
      assert.equal(page.structuredContent.result[0].revisionNumber, 3);
      assert.equal(requests.at(-1).url, `${rootPath}/discovery-report/revisions?beforeRevision=4&limit=1`);
      await ok("list_migration_discovery_revisions", { id: migrationId, limit: 100 });
      await ok("list_migration_discovery_revisions", { id: migrationId });
      assert.equal(requests.at(-1).url, `${rootPath}/discovery-report/revisions`);
      const saved = await ok("get_migration_discovery_revision", { id: migrationId, revisionId });
      assert.deepEqual(saved.structuredContent.result, revision);
      assert.equal(requests.at(-1).url, `${rootPath}/discovery-report/revisions/${revisionId}`);

      for (const args of [{ id: migrationId }, { id: migrationId, revisionId }, { id: lockedId }]) {
        const handoff = await ok("get_migration_handoff_report", args);
        assert.equal(handoff.content[0].text, report, `${name}: preserve Markdown, never JSON-quote it`);
        assert.equal(handoff.structuredContent.result, report);
        assert.equal(requests.at(-1).method, "GET");
        assert.equal(requests.at(-1).headers.accept, "text/markdown");
        assert.equal(requests.at(-1).url,
          `/api/v1/migrations/${args.id}/handoff-report${args.revisionId ? `?revisionId=${revisionId}` : ""}`);
      }
      for (const toolName of ["get_migration_discovery_revision", "get_migration_handoff_report"]) {
        const count = requests.length;
        const missing = await call(toolName, { id: migrationId, revisionId: missingRevisionId });
        assert.equal(missing.isError, true);
        assert.match(JSON.stringify(missing.content), /HTTP 404.*Saved discovery report/);
        assert.equal(requests.length, count + 1, "missing reports must not silently fall back to the current report");
      }

      const locked = await ok("get_migration", { id: lockedId });
      assert.equal(locked.structuredContent.result.executionCompatibility.locked, true);
      assert.equal(locked.structuredContent.result.pendingAction, null);
      assert.equal(locked.structuredContent.result.blockedReason, lockMessage);
      for (const [toolName, args] of [
        ["confirm_migration", { id: lockedId, approvedRevisionId: revisionId }],
        ["resume_migration", { id: lockedId }],
        ["inspect_migration_source", { id: lockedId, authorizeHelperDeployment: true }],
      ]) {
        const count = requests.length;
        const denied = await call(toolName, args);
        assert.equal(denied.isError, true);
        assert.match(JSON.stringify(denied.content), /HTTP 400.*no longer supported/);
        assert.equal(requests.length, count + 1, "backend lock errors must not trigger legacy retries or pin updates");
      }
      const beforeStale = requests.length;
      const stale = await call("confirm_migration", { id: migrationId, approvedRevisionId: staleRevisionId });
      assert.equal(stale.isError, true);
      assert.match(JSON.stringify(stale.content), /HTTP 409.*Discovery changed/);
      assert.equal(requests.length, beforeStale + 1, "never approve a replacement automatically");
      const approvedResume = await ok("confirm_migration", { id: migrationId });
      assert.equal(approvedResume.structuredContent.result, null, "empty JSON success remains null");
      assert.equal(requests.at(-1).body, "");

      // Source metadata remains backend-derived. Only the explicitly chosen connection is sent.
      for (const source of [targetIntegrationId, sourceIntegrationId, undefined]) {
        const params = { name: "Contract migration", sourceType: "LOVABLE_SUPABASE", templateId,
          targetType: "SUPABASE_CLOUD", targetSupabaseProjectRef: "different-target-project",
          supabaseIntegrationInstanceId: targetIntegrationId,
          ...(source ? { sourceIntegrationInstanceId: source } : {}) };
        await ok("create_migration", params);
        assert.equal(requests.at(-1).method, "POST");
        assert.equal(requests.at(-1).url, "/api/v1/migrations");
        assert.deepEqual(JSON.parse(requests.at(-1).body), params,
          "same/different source integrations pass through; Lovable Cloud must not inherit target access");
      }
      await assert.rejects(() => context.apiFetch("/malformed-json"), SyntaxError,
        "ordinary JSON must not silently turn into text");
      assert.equal(await context.apiFetch("/empty-text", { responseType: "text" }), "");

      for (const request of requests.slice(firstRequest)) {
        assert.equal(request.headers.authorization, `Bearer ${bearer}`);
        if (name === "delegated OAuth") {
          assert.equal(request.headers["x-staticbot-actor-subject"], actor.subject);
          assert.equal(request.headers["x-staticbot-actor-username"], actor.username);
          assert.equal(request.headers["x-staticbot-actor-email"], actor.email);
          assert.equal(request.headers["x-staticbot-actor-scopes"], actor.scopes.join(" "));
          assert.equal(request.headers["x-staticbot-actor-idp"], actor.identityProvider);
          assert.equal(request.headers["x-staticbot-mcp-oauth-client-id"], actor.oauthClientId);
        } else {
          assert.equal(request.headers["x-staticbot-actor-subject"], undefined);
        }
      }
    } finally {
      await client.close();
      await server.close();
    }
  }
  // The direct REST skill must negotiate the Markdown endpoint too; JSON Accept would be 406.
  for (const suffix of ["", `?revisionId=${revisionId}`]) {
    const { stdout } = await promisify(execFile)("bash",
      ["skills/staticbot/scripts/staticbot-api.sh", "GET", `/migrations/${migrationId}/handoff-report${suffix}`],
      { env: { ...process.env, STATICBOT_API_URL: apiUrl, STATICBOT_API_KEY: "contract-direct-key" } });
    assert.equal(stdout, report, "the direct API skill must preserve Markdown without JSON parsing");
    assert.equal(requests.at(-1).headers.accept, "text/markdown");
    assert.equal(requests.at(-1).headers.authorization, "Bearer contract-direct-key");
    assert.equal(requests.at(-1).url, `${rootPath}/handoff-report${suffix}`);
  }
  assert(logs.includes('"event":"mcp.tool"'), "delegated calls must retain operation logging");
  assert(!logs.includes("REPORT_BODY_ONLY_8d1fb4"), "handoff report bodies must not be logged");
  assert(!logs.includes("Guarded activation artifact"), "activation SQL must not be logged on success");
  assert(!logs.includes("contract-service-token"), "service credentials must not be logged");
} finally {
  process.stderr.write = realWrite;
  await new Promise(resolve => apiServer.close(resolve));
}
console.log(`Migration contract checks passed: ${calls} tool calls across API-key and delegated OAuth contexts, plus 2 direct-API handoff reads`);
