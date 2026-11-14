import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../dist/server/create-server.js";
const projectId = "00000000-0000-4000-8000-000000000911";
const runId = "00000000-0000-4000-8000-000000000912";
const requests = [];
const context = { prompt: "Resolve main into staticbot/live preserving the migrated backend.", sourceBranch: "main", targetBranch: "staticbot/live", creditCost: 1 };
const server = createServer({ apiFetch: async (path, options = {}) => { requests.push({ path, method: options.method ?? "GET" }); return options.method ? null : context; }, toText: JSON.stringify });
const client = new Client({ name: "sync-merge-contract", version: "1.0.0" }, { capabilities: {} });
const [ct, st] = InMemoryTransport.createLinkedPair();
await server.connect(st);
try {
  await client.connect(ct);
  const prompt = await client.callTool({ name: "get_sync_merge_conflict", arguments: { projectId, runId } });
  assert.deepEqual(prompt.structuredContent.result, context);
  for (const name of ["resolve_sync_merge_with_ai", "recheck_sync_merge_conflict"]) {
    const count = requests.length;
    assert.equal((await client.callTool({ name, arguments: { projectId, runId } })).isError, true);
    assert.equal((await client.callTool({ name, arguments: { projectId, runId, confirmed: false } })).isError, true);
    assert.equal(requests.length, count, "no mutation without explicit confirmation");
    const result = await client.callTool({ name, arguments: { projectId, runId, confirmed: true } });
    assert.notEqual(result.isError, true);
  }
  const base = `/api/v1/connected-projects/${projectId}/sync-runs/${runId}/conflicts`;
  assert.deepEqual(requests, [{ path: base, method: "GET" }, { path: base + "/resolve-ai", method: "POST" }, { path: base + "/recheck", method: "POST" }]);
  console.log("Sync merge contracts passed: shared prompt, confirmation gates, exact read/paid/recheck routes");
} finally { await client.close(); await server.close(); }
