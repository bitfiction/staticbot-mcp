import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { ToolContext } from "../context.js";

/**
 * Registered on every transport. Bodies are unchanged from the original single-file server; the only
 * difference is that apiFetch and toText now arrive per call rather than closing over module state,
 * which is what lets one registry serve both the API-key stdio server and the hosted OAuth one.
 */
export function registerGateTools(server: McpServer, { apiFetch, toText }: ToolContext): void {
// ─── Gate/action tools (P0 — 2026-07-30) ────────────────────────────────────

server.tool(
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
    return { content: [{ type: "text", text: toText(data) }] };
  }
);

server.tool(
  "provide_base44_secrets",
  "Provide Base44 API key secrets required to complete a Base44-native migration. " +
  "Call when MANUAL_PROVIDE_BASE44_SECRETS is READY. " +
  "IMPORTANT: You MUST ask the user for the required secret values before calling.",
  {
    migrationId: z.string().uuid().describe("Migration ID"),
    jobId: z.string().uuid().describe("The MANUAL_PROVIDE_BASE44_SECRETS job ID"),
    secrets: z.record(z.string()).describe("Map of secret name to value"),
  },
  { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  async ({ migrationId, jobId, secrets }) => {
    const data = await apiFetch(`/api/v1/migrations/${migrationId}/jobs/${jobId}/provide-base44-secrets`, {
      method: "POST",
      body: JSON.stringify({ secrets }),
    });
    return { content: [{ type: "text", text: toText(data) }] };
  }
);

server.tool(
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
    return { content: [{ type: "text", text: toText(data) }] };
  }
);
}
