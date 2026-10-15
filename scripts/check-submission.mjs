import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../dist/server/create-server.js";

const submission = JSON.parse(await readFile(new URL("../chatgpt-app-submission.json", import.meta.url), "utf8"));
const manifest = JSON.parse(await readFile(new URL("../.codex-plugin/plugin.json", import.meta.url), "utf8"));
const server = createServer({ apiFetch: async () => { throw new Error("Metadata validation must not call the API"); },
  toText: JSON.stringify });
const client = new Client({ name: "submission-contract", version: "1.0.0" }, { capabilities: {} });
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
await server.connect(serverTransport);
try {
  await client.connect(clientTransport);
  const { tools } = await client.listTools();
  assert.deepEqual(Object.keys(submission.tools).sort(), tools.map(t => t.name).sort(),
    "submission tool inventory must match the runtime");
  for (const tool of tools) {
    const declared = submission.tools[tool.name];
    for (const hint of ["readOnlyHint", "openWorldHint", "destructiveHint"]) {
      assert.equal(declared.annotations[hint], tool.annotations[hint], `${tool.name}.${hint} drifted`);
    }
    for (const key of ["read_only_justification", "open_world_justification", "destructive_justification"]) {
      assert.equal(typeof declared.justifications[key], "string", `${tool.name} lacks ${key}`);
      assert(declared.justifications[key].trim(), `${tool.name}.${key} is empty`);
    }
  }
  assert.equal(submission.test_cases.length, 5, "review needs exactly five positive cases");
  assert.equal(submission.negative_test_cases.length, 3, "review needs exactly three negative cases");
  for (const test of submission.test_cases) assert(submission.tools[test.tools_triggered], "unknown review test tool");
  for (const subtitle of [submission.app_info.subtitle, manifest.interface.shortDescription]) {
    assert(subtitle.trim() && subtitle.length <= 30 && !/[\r\n]/.test(subtitle), "listing subtitle must fit 30 characters");
  }
  console.log(`Submission contract passed: ${tools.length} tools, annotations, justifications, 5 positive/3 negative cases`);
} finally {
  await client.close();
  await server.close();
}
