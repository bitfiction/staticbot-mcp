import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { ToolContext } from "../context.js";
import { registerConnectedProjectTools } from "../tools/connected-projects.js";
import { registerDeploymentManagementTools } from "../tools/deployment-management.js";
import { registerDeploymentTools } from "../tools/deployments.js";
import { registerGateTools } from "../tools/gates.js";
import { registerMigrationTools } from "../tools/migrations.js";
import { registerStackTools } from "../tools/stacks.js";
import { registerTemplateTools } from "../tools/templates.js";

export const SERVER_NAME = "staticbot";
export const SERVER_VERSION = "1.7.1";

/**
 * The tool registry, shared by every transport.
 *
 * Single definition on purpose: with a copy per transport, stdio and hosted drift into subtly
 * different tool sets, and the divergence only surfaces when a customer reports a tool behaving
 * differently in ChatGPT than in Claude Code.
 *
 * Transport-specific tools are NOT registered here — see `registerLovableSyncBridge`, which is
 * stdio-only because it depends on a browser extension reaching the user's own machine.
 */
export function createServer(context: ToolContext): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  registerTemplateTools(server, context);
  registerStackTools(server, context);
  registerDeploymentTools(server, context);
  registerDeploymentManagementTools(server, context);
  registerMigrationTools(server, context);
  registerConnectedProjectTools(server, context);
  registerGateTools(server, context);

  return server;
}
