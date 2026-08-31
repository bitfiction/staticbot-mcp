#!/usr/bin/env node
import { loadConfig } from "./config.js";
import { createHostedServer } from "./http.js";

/** Hosted entrypoint. The stdio server (`src/index.ts`) shares its tool registry. */
const config = loadConfig();
const server = createHostedServer(config);

server.listen(config.port, () => {
  process.stderr.write(
    `Staticbot MCP listening on :${config.port} (resource ${config.mcpResource}, issuer ${config.issuer})\n`,
  );
});

/**
 * Drain rather than drop. Kubernetes sends SIGTERM and removes the pod from the Service at roughly
 * the same moment, so a request already in flight is still ours to finish — closing the listener
 * stops new connections while existing ones complete. Without this a rolling update fails whatever
 * calls were mid-flight, which an agent surfaces to the user as the product being broken.
 */
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    process.stderr.write(`${signal} received, draining\n`);
    server.close(() => process.exit(0));
    // Backstop: if a connection never closes, do not outlive the pod's grace period.
    setTimeout(() => process.exit(0), 25_000).unref();
  });
}
