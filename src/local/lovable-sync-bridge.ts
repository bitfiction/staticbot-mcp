import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { ToolContext } from "../context.js";

/**
 * STDIO ONLY — deliberately not part of the hosted server.
 *
 * `lovable_sync` needs a Chrome extension on the *user's own machine* to reach a bridge listening on
 * 127.0.0.1:3847, holds the pending request in module state, and blocks for up to three minutes
 * waiting for the extension to answer. None of that survives a hosted deployment: the server is in
 * Kubernetes where no browser extension can reach it, module state is not shared between replicas,
 * and every replica would try to bind the same port. Registering it over HTTP would advertise a tool
 * that can only ever time out.
 *
 * Calling this function starts the bridge listener as a side effect, so call it only from the stdio
 * entrypoint.
 */
export function registerLovableSyncBridge(server: McpServer, { toText }: ToolContext): void {
// ─── Lovable Sync Bridge (HTTP) ─────────────────────────────────────────────


interface SyncRequest {
  action: "SYNC_REQUEST";
  functionName: string;
  lovableProjectId: string;
  migrationId: string;
  jobId: string;
}

interface SyncResult {
  action: "SYNC_RESULT";
  status: "success" | "error";
  functionUrl?: string;
  message?: string;
}

let pendingSync: SyncRequest | null = null;
let syncResult: SyncResult | null = null;
let syncResultResolve: ((result: SyncResult) => void) | null = null;

const BRIDGE_PORT = 3847;

const bridgeServer = createServer((req: IncomingMessage, res: ServerResponse) => {
  // CORS headers for Chrome extension
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === "GET" && req.url === "/pending-sync") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(pendingSync));
    return;
  }

  if (req.method === "POST" && req.url === "/sync-result") {
    let body = "";
    req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
    req.on("end", () => {
      try {
        const result = JSON.parse(body) as SyncResult;
        syncResult = result;
        if (syncResultResolve) {
          syncResultResolve(result);
          syncResultResolve = null;
        }
        pendingSync = null;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok" }));
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "error", message: "Invalid JSON" }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

bridgeServer.listen(BRIDGE_PORT, "127.0.0.1", () => {
  process.stderr.write(`[staticbot-mcp] Lovable sync bridge listening on http://127.0.0.1:${BRIDGE_PORT}\n`);
});

// Ignore port-in-use errors (another MCP instance may be running)
bridgeServer.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    process.stderr.write(`[staticbot-mcp] Bridge port ${BRIDGE_PORT} already in use, skipping bridge server\n`);
  } else {
    process.stderr.write(`[staticbot-mcp] Bridge server error: ${err.message}\n`);
  }
});

function waitForSyncResult(timeoutMs: number): Promise<SyncResult> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      syncResultResolve = null;
      resolve({ action: "SYNC_RESULT", status: "error", message: "Lovable sync timed out after " + (timeoutMs / 1000) + "s. The function may still be deploying — try again or sync Lovable manually." });
    }, timeoutMs);

    syncResultResolve = (result) => {
      clearTimeout(timer);
      resolve(result);
    };

    // Check if result already arrived
    if (syncResult) {
      clearTimeout(timer);
      syncResultResolve = null;
      const result = syncResult;
      syncResult = null;
      resolve(result);
    }
  });
}

server.tool(
  "lovable_sync",
  "Trigger Lovable to deploy the staticbot edge function via the Chrome extension bridge. " +
  "The Chrome extension must be installed and a Staticbot or Lovable page must be open. " +
  "This tool sets a pending sync request that the Chrome extension picks up, then waits " +
  "for the result (up to 3 minutes). If the extension is not connected, ask the user to " +
  "open their Lovable project and paste 'deploy staticbot edge function' into the Lovable AI chat. " +
  "Use this after DEPLOY_EXPORT_FUNCTION completes and MANUAL_SYNC_LOVABLE is READY.",
  {
    functionName: z.string().describe("Edge function name (e.g. staticbot-export-abc123)"),
    lovableProjectId: z.string().describe("Lovable project ID (UUID from the Lovable URL)"),
    migrationId: z.string().uuid().describe("Migration ID"),
    jobId: z.string().uuid().describe("The MANUAL_SYNC_LOVABLE job ID"),
  },
  async ({ functionName, lovableProjectId, migrationId, jobId }) => {
    // Clear any previous state
    syncResult = null;
    syncResultResolve = null;

    // Set the pending sync request for the Chrome extension to pick up
    pendingSync = {
      action: "SYNC_REQUEST",
      functionName,
      lovableProjectId,
      migrationId,
      jobId,
    };

    // Wait for result (3 minute timeout)
    const result = await waitForSyncResult(180_000);
    pendingSync = null;

    return { content: [{ type: "text", text: toText(result) }] };
  }
);
}
