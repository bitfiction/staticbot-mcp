#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createApiKeyContext } from "./context.js";
import { registerLovableSyncBridge } from "./local/lovable-sync-bridge.js";
import { createServer } from "./server/create-server.js";

/**
 * Local stdio entrypoint: one API key for the process, published as `npx @staticbot/mcp`.
 *
 * It registers the shared registry plus the tools that only make sense when the server runs on the
 * user's own machine.
 */
const API_URL = process.env.STATICBOT_API_URL ?? "https://app.staticbot.dev";
const API_KEY = process.env.STATICBOT_API_KEY;

if (!API_KEY) {
  process.stderr.write("Error: STATICBOT_API_KEY environment variable is required\n");
  process.exit(1);
}

const context = createApiKeyContext(API_URL, API_KEY);
const server = createServer(context);
registerLovableSyncBridge(server, context);

const transport = new StdioServerTransport();
await server.connect(transport);
