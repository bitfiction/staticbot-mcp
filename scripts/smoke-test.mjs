import assert from "node:assert/strict";
import { createServer } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  StdioClientTransport,
  getDefaultEnvironment,
} from "@modelcontextprotocol/sdk/client/stdio.js";

const expectedToolCount = 55;
const expectedTools = [
  "list_templates",
  "get_deployment",
  "push_dns_to_cloudflare",
  "list_aws_hosting_targets",
  "list_cloudflare_hosting_targets",
  "preflight_cloudflare_hosting",
  "recheck_dns_verification",
  "get_migration",
  "clean_migration_target",
  "create_migration_preview",
  "set_connected_project_sync_mode",
  "list_connected_project_previews",
];

const installedCommand = process.env.STATICBOT_MCP_COMMAND;

const apiRequests = [];
const apiServer = createServer(async (request, response) => {
  let body = "";
  for await (const chunk of request) body += chunk;
  apiRequests.push({ method: request.method, url: request.url, body });
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

  const awsTargets = tools.find(({ name }) => name === "list_aws_hosting_targets");
  assert.equal(awsTargets?.annotations?.readOnlyHint, true, "AWS target discovery must be read-only");
  assert.equal(awsTargets?.annotations?.destructiveHint, false, "AWS target discovery is not destructive");
  assert.equal(awsTargets?.annotations?.openWorldHint, false, "AWS targets are bounded to the user's org");
  assert(awsTargets?.inputSchema?.properties?.stackId, "AWS target discovery must accept stackId");

  const createDeployment = tools.find(({ name }) => name === "create_deployment");
  assert(
    createDeployment?.inputSchema?.properties?.targetAccountId,
    "create_deployment must expose the AWS ownership choice as targetAccountId",
  );

  const listResult = await client.callTool({ name: "list_templates", arguments: {} });
  assert.deepEqual(
    listResult.structuredContent,
    { result: [] },
    "tools must return the API JSON through structuredContent.result",
  );

  const stackId = "4b6cc471-b50f-40d5-bfa9-72d86e32f130";
  await client.callTool({ name: "list_aws_hosting_targets", arguments: { stackId } });
  assert(
    apiRequests.some(({ method, url }) =>
      method === "GET" && url === `/api/v1/aws/hosting-targets?stackId=${stackId}`),
    "AWS target discovery must call the public v1 endpoint with stackId",
  );

  await client.callTool({
    name: "create_deployment",
    arguments: { stackId, deploymentType: "PLAN", targetAccountId: "123456789012" },
  });
  const selectedAwsRequest = apiRequests.find(({ method, url, body }) =>
    method === "POST" && url === "/api/v1/deployments" && body.includes("123456789012"));
  assert(selectedAwsRequest, "create_deployment must forward a selected AWS account");
  assert.deepEqual(
    JSON.parse(selectedAwsRequest.body),
    { stackId, deploymentType: "PLAN", targetAccountId: "123456789012" },
    "create_deployment must forward the AWS picker value unchanged",
  );

  await client.callTool({ name: "create_deployment", arguments: { stackId } });
  const defaultDeploymentRequest = apiRequests.at(-1);
  assert.equal(defaultDeploymentRequest.url, "/api/v1/deployments");
  assert.deepEqual(
    JSON.parse(defaultDeploymentRequest.body),
    { stackId, deploymentType: "APPLY" },
    "create_deployment must omit targetAccountId when no AWS choice was supplied",
  );

  console.log(`MCP smoke test passed: ${tools.length} tools registered`);
} finally {
  await client.close();
  await new Promise((resolve, reject) => {
    apiServer.close((error) => error ? reject(error) : resolve());
  });
}
