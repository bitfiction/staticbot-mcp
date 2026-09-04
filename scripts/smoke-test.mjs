import assert from "node:assert/strict";
import { createServer } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  StdioClientTransport,
  getDefaultEnvironment,
} from "@modelcontextprotocol/sdk/client/stdio.js";

const expectedToolCount = 50;
const expectedTools = [
  "list_templates",
  "get_deployment",
  "push_dns_to_cloudflare",
  "recheck_dns_verification",
  "get_migration",
  "clean_migration_target",
  "create_migration_preview",
  "set_connected_project_sync_mode",
];

const installedCommand = process.env.STATICBOT_MCP_COMMAND;

const apiServer = createServer((_request, response) => {
  response.writeHead(200, { "Content-Type": "application/json" });
  response.end("[]");
});
await new Promise((resolve, reject) => {
  apiServer.once("error", reject);
  apiServer.listen(0, "127.0.0.1", resolve);
});
const address = apiServer.address();
assert(address && typeof address === "object", "mock API server must expose its port");

const transport = new StdioClientTransport({
  command: installedCommand ?? process.execPath,
  args: installedCommand ? [] : ["dist/index.js"],
  env: {
    ...getDefaultEnvironment(),
    STATICBOT_API_KEY: "smoke-test-only",
    STATICBOT_API_URL: `http://127.0.0.1:${address.port}`,
  },
  stderr: "pipe",
});

const client = new Client(
  { name: "staticbot-mcp-smoke-test", version: "1.0.0" },
  { capabilities: {} },
);

try {
  await client.connect(transport);
  const { tools } = await client.listTools();
  const names = tools.map(({ name }) => name);

  assert.equal(
    tools.length,
    expectedToolCount,
    `expected ${expectedToolCount} tools, received ${tools.length}`,
  );
  assert.equal(new Set(names).size, names.length, "tool names must be unique");

  for (const name of expectedTools) {
    assert(names.includes(name), `missing representative tool: ${name}`);
  }

  for (const tool of tools) {
    assert(tool.description, `tool ${tool.name} must have a description`);
    assert(tool.inputSchema, `tool ${tool.name} must have an input schema`);
    assert(tool.outputSchema, `tool ${tool.name} must have an output schema`);
    assert(
      tool.outputSchema.properties?.result,
      `tool ${tool.name} output schema must expose the structured API result`,
    );
  }

  const confirmMigration = tools.find(({ name }) => name === "confirm_migration");
  assert(confirmMigration?.inputSchema?.properties?.gateChoice, "confirm_migration must expose gateChoice");
  assert(confirmMigration?.inputSchema?.properties?.gateSelection, "confirm_migration must expose gateSelection");

  const cleanTarget = tools.find(({ name }) => name === "clean_migration_target");
  assert.equal(cleanTarget?.annotations?.readOnlyHint, false, "target cleanup changes state");
  assert.equal(cleanTarget?.annotations?.destructiveHint, true, "target cleanup must be marked destructive");
  assert.deepEqual(
    cleanTarget?.inputSchema?.properties?.scope?.enum,
    ["DATABASE", "STORAGE", "PROJECT"],
    "target cleanup scopes must match the public API",
  );

  const listResult = await client.callTool({ name: "list_templates", arguments: {} });
  assert.deepEqual(
    listResult.structuredContent,
    { result: [] },
    "tools must return the API JSON through structuredContent.result",
  );

  console.log(`MCP smoke test passed: ${tools.length} tools registered`);
} finally {
  await client.close();
  await new Promise((resolve, reject) => {
    apiServer.close((error) => error ? reject(error) : resolve());
  });
}
