import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { ToolContext } from "../context.js";
import { apiToolResult, registerApiTool } from "../server/api-tool.js";

/**
 * Registered on every transport. Bodies are unchanged from the original single-file server; the only
 * difference is that apiFetch and toText now arrive per call rather than closing over module state,
 * which is what lets one registry serve both the API-key stdio server and the hosted OAuth one.
 */
export function registerGateTools(server: McpServer, { apiFetch, toText }: ToolContext): void {
// ─── Gate/action tools (P0 — 2026-07-30) ────────────────────────────────────

registerApiTool(server,
  "create_migration_preview",
  "Trigger (or retrieve) a preview deployment for a migration. The preview builds the migrated " +
  "app on Staticbot's infrastructure so the customer can verify it works before finalising " +
  "backend switchover. Optional mode: 'light' (fast, single SOFTWARE job) or 'full'.",
  {
    migrationId: z.string().uuid().describe("Migration ID"),
    mode: z.enum(["light", "full"]).optional().describe("Preview mode (default: light)"),
  },
  { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  async ({ migrationId, mode }) => {
    const data = await apiFetch(`/api/v1/migrations/${migrationId}/preview?mode=${mode ?? "light"}`, {
      method: "POST",
    });
    return apiToolResult(data, toText);
  }
);

// There is deliberately no `provide_base44_secrets` tool.
//
// The MANUAL_PROVIDE_BASE44_SECRETS gate takes the values of the customer's own third-party
// credentials — Stripe keys and the like — which this transport cannot carry: a tool call's
// arguments are model output, so anything passed here is in the provider's transcript before
// Staticbot sees it. The gate is completed by the user in the dashboard instead, and
// `get_migration`'s pendingAction returns the URL plus a `detail` string to show them (Staticbot
// branches that field on the calling credential). Staticbot's API also refuses the underlying
// endpoint for MCP callers with 403 SECRET_INTAKE_REFUSED, so re-adding a tool here would not work
// even if someone tried.
//
// Shell-capable clients keep the capability through the API directly — see skills/staticbot.

registerApiTool(server,
  "resolve_schema_gap",
  "Resolve a MANUAL_REVIEW_SCHEMA_GAP gate. " +
  "IMPORTANT: You MUST present these options to the user and ask them to choose before calling:\n" +
  "  1. 'recheck' — Re-check the source schema for drift.\n" +
  "  2. 'abort' — Skip the migration.\n" +
  "Do NOT pick an option without asking the user first.",
  {
    migrationId: z.string().uuid().describe("Migration ID"),
    jobId: z.string().uuid().describe("The MANUAL_REVIEW_SCHEMA_GAP job ID"),
    action: z.enum(["recheck", "abort"]).describe("Resolution action"),
  },
  { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  async ({ migrationId, jobId, action }) => {
    const data = await apiFetch(`/api/v1/migrations/${migrationId}/jobs/${jobId}/resolve-schema-gap`, {
      method: "POST",
      body: JSON.stringify({ action }),
    });
    return apiToolResult(data, toText);
  }
);
}
