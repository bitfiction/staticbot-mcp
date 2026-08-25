import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  StdioClientTransport,
  getDefaultEnvironment,
} from "@modelcontextprotocol/sdk/client/stdio.js";

const expectedToolCount = 50;
const expectedTools = [
  "list_templates",
  "get_deployment",
  "get_migration",
  "create_migration_preview",
  "set_connected_project_sync_mode",
];

const installedCommand = process.env.STATICBOT_MCP_COMMAND;

const transport = new StdioClientTransport({
  command: installedCommand ?? process.execPath,
  args: installedCommand ? [] : ["dist/index.js"],
  env: {
    ...getDefaultEnvironment(),
    STATICBOT_API_KEY: "smoke-test-only",
    STATICBOT_API_URL: "http://127.0.0.1:9",
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
  }

  console.log(`MCP smoke test passed: ${tools.length} tools registered`);
} finally {
  await client.close();
}
