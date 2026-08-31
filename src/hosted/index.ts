#!/usr/bin/env node
import { loadConfig } from "./config.js";
import { createHostedServer } from "./http.js";

/** Hosted entrypoint. The stdio server (`src/index.ts`) shares its tool registry. */
const config = loadConfig();

createHostedServer(config).listen(config.port, () => {
  process.stderr.write(
    `Staticbot MCP listening on :${config.port} (resource ${config.mcpResource}, issuer ${config.issuer})\n`,
  );
});
