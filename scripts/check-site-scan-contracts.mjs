import assert from "node:assert/strict";
import { createServer as createHttpServer } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createApiKeyContext } from "../dist/context.js";
import { createDelegatedContext } from "../dist/hosted/context.js";
import { createServer } from "../dist/server/create-server.js";

const id = "00000000-0000-4000-8000-000000000901";
const missingId = "00000000-0000-4000-8000-000000000902";
const requests = [];
const api = createHttpServer(async (request, response) => {
  let body = "";
  for await (const chunk of request) body += chunk;
  requests.push({ method: request.method, url: request.url, headers: request.headers, body });
  const send = (status, value) => {
    response.writeHead(status, { "Content-Type": "application/json" });
    response.end(JSON.stringify(value));
  };
  if (request.url === `/api/v1/site-scans/${missingId}`) return send(404, { code: "NOT_FOUND" });
  if (request.method === "POST" && request.url === "/api/v1/site-scans") {
    if (JSON.parse(body).url === "https://limited.example/") return send(429, { code: "RATE_LIMITED" });
    return send(202, { scan: { id, status: "QUEUED" }, pollAfterMs: 1500 });
  }
  if (request.method === "GET" && request.url === `/api/v1/site-scans/${id}`) {
    return send(200, { scan: { id, status: "COMPLETED", result: { platform: { code: "BASE44" } } } });
  }
  send(404, { code: "UNEXPECTED_ENDPOINT" });
});
await new Promise((resolve, reject) => {
  api.once("error", reject);
  api.listen(0, "127.0.0.1", resolve);
});
const apiUrl = `http://127.0.0.1:${api.address().port}`;
const actor = { subject: "scan-subject", username: "scan-user", email: "scan@example.invalid",
  oauthClientId: "scan-client", scopes: ["staticbot:read", "staticbot:write"] };
try {
  for (const [name, context, bearer] of [
    ["API-key", createApiKeyContext(apiUrl, "scan-test-key"), "scan-test-key"],
    ["OAuth", createDelegatedContext({ apiUrl }, actor, async () => "scan-service-token"), "scan-service-token"],
  ]) {
    const server = createServer(context);
    const client = new Client({ name: `site-scan-${name}`, version: "1.0.0" }, { capabilities: {} });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    try {
      await client.connect(clientTransport);
      const { tools } = await client.listTools();
      assert.deepEqual(tools.find(t => t.name === "scan_website").annotations,
        { readOnlyHint: false, destructiveHint: false, openWorldHint: true });
      assert.equal(tools.find(t => t.name === "get_website_scan").annotations.readOnlyHint, true);
      const firstRequest = requests.length;
      for (const [tool, args] of [["scan_website", { url: "" }], ["scan_website", { url: "x".repeat(2049) }],
        ["get_website_scan", { id: "not-a-uuid" }]]) {
        assert.equal((await client.callTool({ name: tool, arguments: args })).isError, true);
      }
      assert.equal(requests.length, firstRequest, "invalid tool arguments must not reach the API");
      const queued = await client.callTool({ name: "scan_website", arguments: { url: "https://customer.example/" } });
      assert.notEqual(queued.isError, true);
      assert.equal(queued.structuredContent.result.scan.id, id);
      assert.equal(queued.structuredContent.result.pollAfterMs, 1500);
      assert.deepEqual(JSON.parse(requests.at(-1).body), { url: "https://customer.example/" });
      const completed = await client.callTool({ name: "get_website_scan", arguments: { id } });
      assert.equal(completed.structuredContent.result.scan.status, "COMPLETED");
      for (const [tool, args, status] of [["get_website_scan", { id: missingId }, 404],
        ["scan_website", { url: "https://limited.example/" }, 429]]) {
        const before = requests.length;
        const failure = await client.callTool({ name: tool, arguments: args });
        assert.equal(failure.isError, true);
        assert.match(JSON.stringify(failure.content), new RegExp(`HTTP ${status}`));
        assert.equal(requests.length, before + 1, "no hidden retry or fallback to the anonymous scanner");
      }
      for (const request of requests.slice(firstRequest)) {
        assert.equal(request.headers.authorization, `Bearer ${bearer}`);
        assert(request.url.startsWith("/api/v1/site-scans"), "must use the authenticated V1 scanner");
        assert(!request.body.includes("turnstile"));
        if (name === "OAuth") assert.equal(request.headers["x-staticbot-actor-subject"], actor.subject);
      }
    } finally {
      await client.close();
      await server.close();
    }
  }
  console.log("Website scan contracts passed: start/poll, validation, failures and both authentication contexts");
} finally {
  api.closeAllConnections();
  await new Promise(resolve => api.close(resolve));
}
