#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createApiKeyContext } from "./context.js";
import { createServer } from "./server/create-server.js";

/**
 * Local stdio entrypoint: one API key for the process, published as `npx @staticbot/mcp`.
 *
 * It registers exactly the shared registry — no transport-specific tools — so the hosted server
 * exposes the same surface.
 */
const API_URL = process.env.STATICBOT_API_URL ?? "https://app.staticbot.dev";
const API_KEY = process.env.STATICBOT_API_KEY;

if (!API_KEY) {
  process.stderr.write("Error: STATICBOT_API_KEY environment variable is required\n");
  process.exit(1);
}

const context = createApiKeyContext(API_URL, API_KEY);
const server = createServer(context);

const transport = new StdioServerTransport();
await server.connect(transport);
