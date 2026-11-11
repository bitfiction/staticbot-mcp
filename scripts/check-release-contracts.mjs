import assert from "node:assert/strict";
import { createServer as createHttpServer } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createApiKeyContext } from "../dist/context.js";
import { createDelegatedContext } from "../dist/hosted/context.js";
import { createServer } from "../dist/server/create-server.js";

// Sign-in page, release pipeline sign-off, and deployment abort/destroy: each decision forwards exactly what the
// user approved, unconfirmed or incomplete calls never reach V1, and a 409 on a stale approval is not retried.
const id = "00000000-0000-4000-8000-000000000921";
const stageId = "00000000-0000-4000-8000-000000000922";
const deploymentId = "00000000-0000-4000-8000-000000000923";
const projectPath = `/api/v1/connected-projects/${id}`;
const stagePath = `${projectPath}/pipeline/stages/${stageId}`;
const deploymentPath = `/api/v1/deployments/${deploymentId}`;
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
  if (request.url === `${projectPath}/sign-in-page`) return json(200,
    { offered: true, choice: body?.choice ?? null, decisionRequired: !body, options: [], previewLinks: [] });
  if (request.url === `${projectPath}/pipeline`) return json(200,
    { connectedProjectId: id, stages: [{ id: stageId, name: "production", gate: "MANUAL", pendingCommitSha: "abc1234" }] });
  if (request.url === `${stagePath}/approve` || request.url === `${stagePath}/reject`) {
    if (body.expectedCommitSha !== "abc1234") return json(409, { detail: "The release changed" });
    return json(200, { connectedProjectId: id, stages: [], outcome: request.url.endsWith("/approve") ? "DEFERRED" : null });
  }
  if (request.url === `${stagePath}/gate`) return json(200, { connectedProjectId: id, stages: [] });
  if (request.url === `${deploymentPath}/abort`) return json(200, { id: deploymentId, status: "ABORTING" });
  if (request.url === `${deploymentPath}/destroy`) {
    if (body.expectedStatus !== "COMPLETED") return json(409, { detail: "The deployment is now IN_PROGRESS" });
    return json(200, { id: deploymentId, status: "DESTROY_IN_PROGRESS" });
  }
  json(404, { message: "Unexpected route" });
});
await new Promise((resolve, reject) => { api.once("error", reject); api.listen(0, "127.0.0.1", resolve); });
const apiUrl = `http://127.0.0.1:${api.address().port}`;
const actor = { subject: "release-subject", username: "reviewer", email: "reviewer@example.invalid",
  oauthClientId: "release-client", scopes: ["staticbot:read", "staticbot:write"] };
const signOff = { id, stageId, confirmed: true, expectedCommitSha: "abc1234" };
try {
  for (const [name, context, token] of [
    ["API-key", createApiKeyContext(apiUrl, "release-key"), "release-key"],
    ["OAuth", createDelegatedContext({ apiUrl }, actor, async () => "release-service"), "release-service"],
  ]) {
    const server = createServer(context);
    const client = new Client({ name: `release-${name}`, version: "1.0.0" }, { capabilities: {} });
    const [ct, st] = InMemoryTransport.createLinkedPair(); await server.connect(st);
    try {
      await client.connect(ct);
      const beforeInvalid = requests.length;
      for (const [tool, args] of [
        ["set_sign_in_page", { id, choice: "APP" }],
        ["set_sign_in_page", { id, choice: "SOMETHING", confirmed: true }],
        ["approve_release", { id, stageId, confirmed: true }],
        ["approve_release", { ...signOff, confirmed: false }],
        ["reject_release", { id, stageId, expectedCommitSha: "abc1234" }],
        ["set_release_gate", { id, stageId, gate: "AUTO" }],
        ["abort_deployment", { id: deploymentId }],
        ["destroy_deployment", { id: deploymentId, confirmed: true }],
      ]) assert.equal((await client.callTool({ name: tool, arguments: args })).isError, true, `${name}: ${tool} must refuse`);
      assert.equal(requests.length, beforeInvalid, "unconfirmed or incomplete decisions must not reach V1");

      const cases = [
        ["get_sign_in_page", { id }, "GET", `${projectPath}/sign-in-page`],
        ["set_sign_in_page", { id, choice: "APP", confirmed: true }, "PUT", `${projectPath}/sign-in-page`],
        ["get_release_pipeline", { id }, "GET", `${projectPath}/pipeline`],
        ["approve_release", signOff, "POST", `${stagePath}/approve`],
        ["reject_release", signOff, "POST", `${stagePath}/reject`],
        ["set_release_gate", { id, stageId, gate: "MANUAL", confirmed: true }, "PATCH", `${stagePath}/gate`],
        ["abort_deployment", { id: deploymentId, confirmed: true }, "POST", `${deploymentPath}/abort`],
        ["destroy_deployment", { id: deploymentId, confirmed: true, expectedStatus: "COMPLETED" }, "POST", `${deploymentPath}/destroy`],
      ];
      for (const [tool, args, method, path] of cases) {
        const result = await client.callTool({ name: tool, arguments: args });
        assert.notEqual(result.isError, true, `${name}: ${tool}`);
        const request = requests.at(-1);
        assert.equal(request.method, method); assert.equal(request.url, path);
        assert.equal(request.headers.authorization, `Bearer ${token}`);
        if (name === "OAuth") assert.equal(request.headers["x-staticbot-actor-subject"], actor.subject);
        if (method !== "GET") {
          const { id: _id, stageId: _stage, ...expectedBody } = args;
          assert.deepEqual(request.body, expectedBody, `${tool} forwards exactly what was approved`);
        }
        if (tool === "approve_release") assert.equal(result.structuredContent.result.outcome, "DEFERRED");
      }

      for (const [tool, args] of [
        ["approve_release", { ...signOff, expectedCommitSha: "stale00" }],
        ["destroy_deployment", { id: deploymentId, confirmed: true, expectedStatus: "IN_PROGRESS" }],
      ]) {
        const before = requests.length;
        const result = await client.callTool({ name: tool, arguments: args });
        assert.equal(result.isError, true); assert.match(JSON.stringify(result.content), /HTTP 409/);
        assert.equal(requests.length, before + 1, "a stale approval is reported, never retried with a substituted target");
      }
    } finally { await client.close(); await server.close(); }
  }
  console.log("Release contracts passed: 8 tools, confirmations, exact approvals, stale-state refusals, both credentials");
} finally { api.closeAllConnections(); await new Promise(resolve => api.close(resolve)); }
