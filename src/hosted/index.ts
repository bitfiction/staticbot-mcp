#!/usr/bin/env node
import { loadConfig } from "./config.js";
import { createHostedServer } from "./http.js";
import { describeLogTarget, logEvent } from "../log.js";

/** Hosted entrypoint. The stdio server (`src/index.ts`) shares its tool registry. */
const config = loadConfig();
const server = createHostedServer(config);

server.listen(config.port, () => {
  logEvent("mcp.listening", {
    port: config.port,
    resource: config.mcpResource,
    issuer: config.issuer,
    ...describeLogTarget(),
  });
});

/**
 * Drain rather than drop. Kubernetes sends SIGTERM and removes the pod from the Service at roughly
 * the same moment, so a request already in flight is still ours to finish — closing the listener
 * stops new connections while existing ones complete. Without this a rolling update fails whatever
 * calls were mid-flight, which an agent surfaces to the user as the product being broken.
 */
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    logEvent("mcp.draining", { signal });
    server.close(() => process.exit(0));
    // Backstop: if a connection never closes, do not outlive the pod's grace period.
    setTimeout(() => process.exit(0), 25_000).unref();
  });
}

/**
 * Anything reaching here has already escaped every handler we wrote, so the only useful thing left
 * is to write it down before the process dies. Without this the failure is a connection that
 * silently drops — the customer sees a tool call that never answers, and nothing on our side
 * explains it. Exit is deliberate and matches Node's default: a process in an unknown state is the
 * pod's problem to replace, not to keep serving from.
 */
process.on("uncaughtException", (error) => {
  logEvent("mcp.fatal", { kind: "uncaughtException", error: error.message, stack: error.stack }, "error");
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  logEvent(
    "mcp.fatal",
    {
      kind: "unhandledRejection",
      error: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
    },
    "error",
  );
  process.exit(1);
});
