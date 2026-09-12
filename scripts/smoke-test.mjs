import assert from "node:assert/strict";
import { createServer } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  StdioClientTransport,
  getDefaultEnvironment,
} from "@modelcontextprotocol/sdk/client/stdio.js";

const expectedToolCount = 59;
const expectedTools = [
  "get_account_status",
  "list_templates",
  "get_deployment",
  "push_dns_to_cloudflare",
  "list_aws_hosting_targets",
  "list_cloudflare_hosting_targets",
  "preflight_cloudflare_hosting",
  "recheck_dns_verification",
  "get_migration",
  "list_source_repositories",
  "list_github_repositories",
  "get_clean_target_plan",
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

  // The pre-migration counterpart to a migration's pendingAction. Without it an agent has no state
  // to read before a migration exists, and falls back to whatever the descriptions narrate.
  const accountStatus = tools.find(({ name }) => name === "get_account_status");
  assert.equal(accountStatus?.annotations?.readOnlyHint, true, "account status must be read-only");
  assert.match(
    accountStatus?.description ?? "",
    /pendingAction/,
    "account status must tell agents to follow pendingAction",
  );
  assert.match(
    accountStatus?.description ?? "",
    /do not default to migration/i,
    "account status must stop agents assuming migration is the next step",
  );

  const createMigrationPath = tools.find(({ name }) => name === "create_migration");
  assert.match(
    createMigrationPath?.description ?? "",
    /call get_account_status/i,
    "migration creation must check readiness before gathering parameters",
  );

  const sourceRepositoriesPath = tools.find(({ name }) => name === "list_source_repositories");
  assert.match(
    sourceRepositoriesPath?.description ?? "",
    /not itself a decision to migrate/i,
    "repository discovery must not narrate migration as its follow-on",
  );

  const confirmMigration = tools.find(({ name }) => name === "confirm_migration");
  assert(confirmMigration?.inputSchema?.properties?.gateChoice, "confirm_migration must expose gateChoice");
  assert(confirmMigration?.inputSchema?.properties?.gateSelection, "confirm_migration must expose gateSelection");

  const createMigration = tools.find(({ name }) => name === "create_migration");
  assert.match(
    createMigration?.description ?? "",
    /call list_source_repositories \(no arguments\) before asking for any repository URL/i,
    "migration guidance must discover repositories across every connected account first",
  );

  const createTemplate = tools.find(({ name }) => name === "create_template");
  assert.match(
    createTemplate?.description ?? "",
    /private repositories are supported/i,
    "template guidance must state that connected private repositories are supported",
  );
  assert.match(
    createTemplate?.description ?? "",
    /list_source_repositories/,
    "template guidance must direct clients to repository discovery",
  );
  assert(
    createTemplate?.inputSchema?.properties?.sourceControlIntegrationInstanceId,
    "create_template must accept the integration the repository was discovered through",
  );

  const sourceRepositories = tools.find(({ name }) => name === "list_source_repositories");
  assert.equal(sourceRepositories?.annotations?.readOnlyHint, true, "repository discovery must be read-only");
  assert(
    sourceRepositories?.inputSchema?.properties?.integrationInstanceId,
    "repository discovery must accept an integration instance ID",
  );
  // Required would force agents to pick one account up front, which is the bug: the other
  // connected accounts' repositories then never appear.
  assert(
    !(sourceRepositories?.inputSchema?.required ?? []).includes("integrationInstanceId"),
    "repository discovery must default to every connected account",
  );
  assert.match(
    sourceRepositories?.description ?? "",
    /gitlab/i,
    "repository discovery must advertise that it is not GitHub-only",
  );
  assert.match(
    sourceRepositories?.description ?? "",
    /sourceLabel/,
    "repository discovery must tell agents where each repository is hosted",
  );

  // Kept registered for clients and cached skills pinned to the old name.
  const githubRepositories = tools.find(({ name }) => name === "list_github_repositories");
  assert.equal(githubRepositories?.annotations?.readOnlyHint, true, "GitHub repository discovery must be read-only");
  assert(
    githubRepositories?.inputSchema?.properties?.githubIntegrationInstanceId,
    "GitHub repository discovery must require an integration instance ID",
  );
  assert.match(
    githubRepositories?.description ?? "",
    /deprecated/i,
    "the GitHub-only alias must point clients at list_source_repositories",
  );

  // The guidance told agents to inspect the plan before authorizing an irreversible action, but no
  // tool exposed the endpoint — so the instruction could not be followed.
  const cleanTargetPlan = tools.find(({ name }) => name === "get_clean_target_plan");
  assert.equal(cleanTargetPlan?.annotations?.readOnlyHint, true, "inspecting a cleanup plan must be read-only");
  assert.equal(cleanTargetPlan?.annotations?.destructiveHint, false, "inspecting a plan removes nothing");
  assert(cleanTargetPlan?.inputSchema?.properties?.id, "the cleanup plan must be looked up by migration");

  const cleanTarget = tools.find(({ name }) => name === "clean_migration_target");
  assert.match(
    cleanTarget?.description ?? "",
    /get_clean_target_plan/,
    "destructive cleanup must point at the plan it should be authorized from",
  );
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

  await client.callTool({ name: "get_account_status", arguments: {} });
  assert(
    apiRequests.some(({ method, url }) => method === "GET" && url === "/api/v1/me"),
    "account status must read the public v1 account endpoint",
  );

  const listResult = await client.callTool({ name: "list_templates", arguments: {} });
  assert.deepEqual(
    listResult.structuredContent,
    { result: [] },
    "tools must return the API JSON through structuredContent.result",
  );

  const integrationInstanceId = "79f97fb7-51c4-4a70-8453-6c1d59d1efb1";
  await client.callTool({ name: "list_source_repositories", arguments: {} });
  assert(
    apiRequests.some(({ method, url }) => method === "GET" && url === "/api/v1/integrations/repositories"),
    "repository discovery with no argument must list every connected account",
  );

  await client.callTool({
    name: "list_source_repositories",
    arguments: { integrationInstanceId },
  });
  assert(
    apiRequests.some(({ method, url }) =>
      method === "GET" &&
      url === `/api/v1/integrations/instances/${integrationInstanceId}/repositories`),
    "repository discovery with an instance must narrow to that account",
  );

  await client.callTool({
    name: "list_github_repositories",
    arguments: { githubIntegrationInstanceId: integrationInstanceId },
  });
  assert(
    apiRequests.some(({ method, url }) =>
      method === "GET" &&
      url === `/api/v1/migrations/integrations/instances/${integrationInstanceId}/github-repositories`),
    "the GitHub-only alias must keep calling the endpoint older clients expect",
  );

  await client.callTool({
    name: "create_template",
    arguments: {
      repoLink: "https://gitlab.com/group/project",
      sourceControlIntegrationInstanceId: integrationInstanceId,
    },
  });
  assert(
    apiRequests.some(({ method, url, body }) =>
      method === "POST" && url === "/api/v1/templates" &&
      body.includes(`"sourceControlIntegrationInstanceId":"${integrationInstanceId}"`)),
    "create_template must forward the integration the repository was discovered through",
  );

  const migrationId = "0b4f2a27-6d19-4a3b-9a1e-2c7d5f8e9b03";
  await client.callTool({ name: "get_clean_target_plan", arguments: { id: migrationId } });
  assert(
    apiRequests.some(({ method, url }) =>
      method === "GET" && url === `/api/v1/migrations/${migrationId}/clean-target-plan`),
    "the cleanup plan must read the live v1 endpoint rather than reusing discovery state",
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
