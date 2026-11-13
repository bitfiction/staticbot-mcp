import assert from "node:assert/strict";
import { createServer as createHttpServer } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createApiKeyContext } from "../dist/context.js";
import { createDelegatedContext } from "../dist/hosted/context.js";
import { createServer } from "../dist/server/create-server.js";

const id = "00000000-0000-4000-8000-000000000931";
const templateId = "00000000-0000-4000-8000-000000000932";
const stackId = "00000000-0000-4000-8000-000000000933";
const state = "a".repeat(64);
const path = `/api/v1/connected-projects/${id}/hosting/launch`;
const requests = [];
const api = createHttpServer(async (req, res) => {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  const body = raw ? JSON.parse(raw) : null;
  requests.push({ method: req.method, url: req.url, headers: req.headers, body });
  let status = 200;
  let result = { plan: { projectId: id, templateId, templateVersion: "1.0.0", stateVersion: state,
    existingStackId: null, migratedBackendAvailable: true, signIn: { decisionRequired: true } }, domains: [] };
  if (req.method === "POST") {
    if (body.expectedState !== state) { status = 409; result = { code: "LAUNCH_STATE_CHANGED", message: "Inspect the new plan" }; }
    else result = { projectId: id, stackId, status: "CONFIGURED", domain: "launch.example.invalid",
      message: "No deployment was created or started." };
  }
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(result));
});
await new Promise((resolve, reject) => { api.once("error", reject); api.listen(0, "127.0.0.1", resolve); });
const apiUrl = `http://127.0.0.1:${api.address().port}`;
const actor = { subject: "launch-reviewer", username: "reviewer", email: "reviewer@example.invalid",
  oauthClientId: "launch-client", scopes: ["staticbot:read", "staticbot:write"] };
const launch = { id, templateId, templateVersion: "1.0.0", expectedState: state, confirmed: true,
  domainOption: { type: "AUTO_GENERATED" }, useMigratedBackend: true, signInPage: "STATICBOT" };
try {
  for (const [kind, context, token] of [
    ["API-key", createApiKeyContext(apiUrl, "launch-key"), "launch-key"],
    ["OAuth", createDelegatedContext({ apiUrl }, actor, async () => "launch-service"), "launch-service"],
  ]) {
    const server = createServer(context);
    const client = new Client({ name: `project-launch-${kind}`, version: "1.0.0" }, { capabilities: {} });
    const [ct, st] = InMemoryTransport.createLinkedPair(); await server.connect(st);
    try {
      await client.connect(ct);
      const beforeRead = requests.length;
      const read = await client.callTool({ name: "get_connected_project_launch", arguments: { id, templateId } });
      assert.notEqual(read.isError, true);
      assert.equal(requests.length, beforeRead + 1);
      assert.equal(requests.at(-1).method, "GET");
      assert.equal(requests.at(-1).url, `${path}?templateId=${templateId}`);
      const beforeInvalid = requests.length;
      for (const args of [
        { ...launch, confirmed: undefined }, { ...launch, confirmed: false },
        { ...launch, expectedState: "stale" }, { ...launch, templateVersion: "" },
        { ...launch, useMigratedBackend: undefined }, { ...launch, domainOption: undefined },
      ]) assert.equal((await client.callTool({ name: "launch_connected_project", arguments: args })).isError, true);
      assert.equal(requests.length, beforeInvalid, "incomplete approval cannot reach V1");
      for (const domainOption of [
        { type: "AUTO_GENERATED" }, { type: "CUSTOM_DOMAIN", domainName: "launch.example.invalid" },
        { type: "EXISTING_DOMAIN", dnsDomainId: stackId },
      ]) {
        const args = { ...launch, domainOption };
        const before = requests.length;
        const result = await client.callTool({ name: "launch_connected_project", arguments: args });
        assert.notEqual(result.isError, true);
        assert.equal(requests.length, before + 1, "launch cannot implicitly create/start a deployment");
        const request = requests.at(-1);
        assert.equal(request.method, "POST"); assert.equal(request.url, path);
        assert.deepEqual(request.body, Object.fromEntries(Object.entries(args).filter(([k]) => k !== "id")));
        assert.equal(request.headers.authorization, `Bearer ${token}`);
        if (kind === "OAuth") assert.equal(request.headers["x-staticbot-actor-subject"], actor.subject);
        assert.equal(result.structuredContent.result.status, "CONFIGURED");
        assert.match(result.structuredContent.result.message, /No deployment/);
      }
      const beforeStale = requests.length;
      const stale = await client.callTool({ name: "launch_connected_project", arguments: { ...launch, expectedState: "b".repeat(64) } });
      assert.equal(stale.isError, true);
      assert.match(JSON.stringify(stale.content), /HTTP 409/);
      assert.equal(requests.length, beforeStale + 1, "a stale plan is never retried or replaced");
    } finally { await client.close(); await server.close(); }
  }
  console.log("Project launch contracts passed: exact choices, explicit approval, no implicit deployment, stale state, both credentials");
} finally { api.closeAllConnections(); await new Promise(resolve => api.close(resolve)); }
