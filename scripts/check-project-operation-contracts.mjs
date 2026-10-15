import assert from "node:assert/strict";
import { createServer as createHttpServer } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createApiKeyContext } from "../dist/context.js";
import { createDelegatedContext } from "../dist/hosted/context.js";
import { createServer } from "../dist/server/create-server.js";

const id = "00000000-0000-4000-8000-000000000911";
const missingId = "00000000-0000-4000-8000-000000000912";
const configId = "00000000-0000-4000-8000-000000000913";
const runId = "00000000-0000-4000-8000-000000000914";
const projectPath = `/api/v1/connected-projects/${id}`;
const migrationPath = `/api/v1/migrations/${id}`;
const requests = [];
const api = createHttpServer(async (request, response) => {
  let raw = "";
  for await (const chunk of request) raw += chunk;
  const body = raw ? JSON.parse(raw) : null;
  requests.push({ method: request.method, url: request.url, headers: request.headers, body });
  const json = (status, payload) => {
    response.writeHead(status, { "Content-Type": "application/json" });
    response.end(JSON.stringify(payload));
  };
  if (request.url === `/api/v1/migrations/${missingId}/live-site`) {
    response.writeHead(204); return response.end();
  }
  if (request.url === `${migrationPath}/live-commit-check`) return json(200,
    { verdict: "UNKNOWN", checkedAt: "2026-10-15T00:00:00Z", message: "Provider did not answer" });
  if (request.url === `${migrationPath}/live-site`) return json(request.method === "PUT" ? 202 : 200,
    { scan: { id: runId, status: "QUEUED" }, pollAfterMs: 1500 });
  if (request.url === `${projectPath}/operations`) return json(200,
    { id, builderBranch: "main", liveBranch: "staticbot/live", webhook: { repositoryConfigId: configId, affectedTemplates: 2 } });
  if (request.url === `${projectPath}/build-preview`) return json(202, { message: "Queued" });
  if (request.url === `${projectPath}/live-branch` || request.url === `${projectPath}/sync-to-live`) {
    if (body.expectedLiveBranch !== "staticbot/live") return json(409, { message: "Branch targets changed" });
    return request.url.endsWith("/live-branch") ? json(200, { liveBranch: "main", redeployed: false, message: "Switched; redeploy failed" })
      : json(202, { started: false, alreadyRunning: true, runId, message: "Already running" });
  }
  if (["setup-webhook", "reset-webhook", "disable-webhook"].some(suffix => request.url === `${projectPath}/${suffix}`)) {
    if (body.expectedRepositoryConfigId !== configId) return json(409, { message: "Repository changed" });
    return json(200, { webhook: { repositoryConfigId: configId }, remoteDeletionVerified: false, message: "Inspect upstream if necessary" });
  }
  json(404, { message: "Unexpected route" });
});
await new Promise((resolve, reject) => { api.once("error", reject); api.listen(0, "127.0.0.1", resolve); });
const apiUrl = `http://127.0.0.1:${api.address().port}`;
const actor = { subject: "parity-subject", username: "reviewer", email: "reviewer@example.invalid",
  oauthClientId: "parity-client", scopes: ["staticbot:read", "staticbot:write"] };
const branch = { id, confirmed: true, expectedLiveBranch: "staticbot/live", expectedBuilderBranch: "main" };
const hook = { id, confirmed: true, expectedRepositoryConfigId: configId };
try {
  for (const [name, context, token] of [
    ["API-key", createApiKeyContext(apiUrl, "parity-key"), "parity-key"],
    ["OAuth", createDelegatedContext({ apiUrl }, actor, async () => "parity-service"), "parity-service"],
  ]) {
    const server = createServer(context);
    const client = new Client({ name: `parity-${name}`, version: "1.0.0" }, { capabilities: {} });
    const [ct, st] = InMemoryTransport.createLinkedPair(); await server.connect(st);
    try {
      await client.connect(ct);
      const beforeInvalid = requests.length;
      for (const [tool, args] of [
        ["build_connected_project_preview", { id }],
        ["switch_connected_project_live_branch", { ...branch, confirmed: false }],
        ["sync_connected_project_to_live", { id, confirmed: true }],
        ["reset_connected_project_webhook", { id, confirmed: true }],
        ["set_migration_live_site", { id, url: "" }],
        ["get_migration_live_commit_check", { id: "not-an-id" }],
      ]) assert.equal((await client.callTool({ name: tool, arguments: args })).isError, true);
      assert.equal(requests.length, beforeInvalid, "invalid or unconfirmed operations must not reach V1");
      const cases = [
        ["get_migration_live_site", { id }, "GET", `${migrationPath}/live-site`],
        ["set_migration_live_site", { id, url: "https://customer.example/" }, "PUT", `${migrationPath}/live-site`],
        ["get_migration_live_commit_check", { id }, "GET", `${migrationPath}/live-commit-check`],
        ["get_connected_project_operations", { id }, "GET", `${projectPath}/operations`],
        ["build_connected_project_preview", { id, confirmed: true }, "POST", `${projectPath}/build-preview`],
        ["switch_connected_project_live_branch", branch, "POST", `${projectPath}/live-branch`],
        ["sync_connected_project_to_live", branch, "POST", `${projectPath}/sync-to-live`],
        ["setup_connected_project_webhook", hook, "POST", `${projectPath}/setup-webhook`],
        ["reset_connected_project_webhook", hook, "POST", `${projectPath}/reset-webhook`],
        ["disable_connected_project_webhook", hook, "POST", `${projectPath}/disable-webhook`],
      ];
      for (const [tool, args, method, path] of cases) {
        const result = await client.callTool({ name: tool, arguments: args });
        assert.notEqual(result.isError, true, `${name}: ${tool}`);
        const request = requests.at(-1);
        assert.equal(request.method, method); assert.equal(request.url, path);
        assert.equal(request.headers.authorization, `Bearer ${token}`);
        if (name === "OAuth") assert.equal(request.headers["x-staticbot-actor-subject"], actor.subject);
        if (method !== "GET") { const { id: _id, ...expectedBody } = args; assert.deepEqual(request.body, expectedBody); }
        if (tool === "get_migration_live_commit_check") assert.equal(result.structuredContent.result.verdict, "UNKNOWN");
        if (tool === "switch_connected_project_live_branch") assert.equal(result.structuredContent.result.redeployed, false);
        if (tool === "sync_connected_project_to_live") assert.equal(result.structuredContent.result.alreadyRunning, true);
        if (tool.endsWith("_webhook")) assert.equal(result.structuredContent.result.remoteDeletionVerified, false);
      }
      const absent = await client.callTool({ name: "get_migration_live_site", arguments: { id: missingId } });
      assert.equal(absent.structuredContent.result, null, "204 means no live-site evidence");
      for (const [tool, args] of [
        ["switch_connected_project_live_branch", { ...branch, expectedLiveBranch: "stale" }],
        ["reset_connected_project_webhook", { ...hook, expectedRepositoryConfigId: missingId }],
      ]) {
        const before = requests.length;
        const result = await client.callTool({ name: tool, arguments: args });
        assert.equal(result.isError, true); assert.match(JSON.stringify(result.content), /HTTP 409/);
        assert.equal(requests.length, before + 1, "stale confirmations must not be retried with substituted targets");
      }
    } finally { await client.close(); await server.close(); }
  }
  console.log("Project operation contracts passed: 10 tools, confirmations, stale targets, retained evidence, both credentials");
} finally { api.closeAllConnections(); await new Promise(resolve => api.close(resolve)); }
