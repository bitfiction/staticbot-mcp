import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { ToolContext } from "../context.js";
import { apiToolResult, registerApiTool } from "../server/api-tool.js";

/**
 * Registered on every transport. Bodies are unchanged from the original single-file server; the only
 * difference is that apiFetch and toText now arrive per call rather than closing over module state,
 * which is what lets one registry serve both the API-key stdio server and the hosted OAuth one.
 */
export function registerConnectedProjectTools(server: McpServer, { apiFetch, toText }: ToolContext): void {
// ─── Connected Projects (Continuous Sync) ───────────────────────────────────

registerApiTool(server,
  "list_connected_projects",
  "List all connected projects. Connected projects sync changes from a GitHub repo to a target Supabase instance and optional Staticbot deployment. After a migration completes, enable continuous sync to keep the target up-to-date with Lovable, Bolt, Base44, or Firebase changes.",
  {
    syncMode: z.enum(["AUTOMATIC", "MANUAL", "PAUSED", "ARCHIVED"]).optional().describe("Filter by sync mode"),
  },
  { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  async ({ syncMode }) => {
    const qs = syncMode ? `?syncMode=${encodeURIComponent(syncMode)}` : "";
    const data = await apiFetch(`/api/v1/connected-projects${qs}`);
    return apiToolResult(data, toText);
  }
);

registerApiTool(server,
  "get_connected_project",
  "Get details of a connected project including sync mode, webhook status, linked migration, and deployment.",
  {
    id: z.string().uuid().describe("Connected project ID"),
  },
  { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  async ({ id }) => {
    const data = await apiFetch(`/api/v1/connected-projects/${id}`);
    return apiToolResult(data, toText);
  }
);

registerApiTool(server,
  "trigger_sync",
  "Trigger a manual sync for a connected project. Detects changes since the last sync (new database migrations, edge function updates, frontend changes) and applies them to the target Supabase instance and the project's Staticbot-selected deployment target.",
  {
    id: z.string().uuid().describe("Connected project ID"),
    commitSha: z.string().optional().describe("Specific commit SHA to sync to (defaults to latest on branch)"),
  },
  { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  async ({ id, commitSha }) => {
    const body = commitSha ? { commitSha } : {};
    const data = await apiFetch(`/api/v1/connected-projects/${id}/sync`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    return apiToolResult(data, toText);
  }
);

registerApiTool(server,
  "list_sync_runs",
  "List sync run history for a connected project. Each sync run represents one execution of the sync pipeline — applying migrations, deploying edge functions, and rebuilding the frontend.",
  {
    id: z.string().uuid().describe("Connected project ID"),
  },
  { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  async ({ id }) => {
    const data = await apiFetch(`/api/v1/connected-projects/${id}/sync-runs`);
    return apiToolResult(data, toText);
  }
);

registerApiTool(server,
  "get_sync_run",
  "Get details of a specific sync run including status, source and target repository versions, summary of changes, and error information. Use the returned version fields when explaining or reviewing the diff; do not infer them. Statuses: PENDING → IN_PROGRESS → COMPLETED/FAILED. Destructive migrations cause PAUSED_FOR_REVIEW.",
  {
    projectId: z.string().uuid().describe("Connected project ID"),
    runId: z.string().uuid().describe("Sync run ID"),
  },
  { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  async ({ projectId, runId }) => {
    const data = await apiFetch(`/api/v1/connected-projects/${projectId}/sync-runs/${runId}`);
    return apiToolResult(data, toText);
  }
);

registerApiTool(server,
  "get_sync_run_jobs",
  "Get all jobs for a sync run. Jobs are the individual work units (e.g. apply_migration, deploy_edge_function, frontend_deploy). Use this to diagnose sync failures at the job level.",
  {
    projectId: z.string().uuid().describe("Connected project ID"),
    runId: z.string().uuid().describe("Sync run ID"),
  },
  { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  async ({ projectId, runId }) => {
    const data = await apiFetch(`/api/v1/connected-projects/${projectId}/sync-runs/${runId}/jobs`);
    return apiToolResult(data, toText);
  }
);

registerApiTool(server,
  "confirm_sync_run",
  "Confirm a sync run that is PAUSED_FOR_REVIEW. Destructive database migrations (DROP TABLE, ALTER COLUMN) pause the sync for review before applying. Optionally skip the destructive migrations instead of applying them.",
  {
    projectId: z.string().uuid().describe("Connected project ID"),
    runId: z.string().uuid().describe("Sync run ID"),
    skipDestructive: z.boolean().optional().describe("If true, skip destructive migrations instead of applying them"),
  },
  { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
  async ({ projectId, runId, skipDestructive }) => {
    const body = skipDestructive !== undefined ? { skipDestructive } : {};
    const data = await apiFetch(`/api/v1/connected-projects/${projectId}/sync-runs/${runId}/confirm`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    return apiToolResult(data, toText);
  }
);


registerApiTool(server,
  "retry_sync_run",
  "Retry a connected-project sync run in FAILED status. Resets its failed jobs to PENDING and reopens the run. Use get_sync_run and get_sync_run_jobs first to explain the failure to the user.",
  {
    projectId: z.string().uuid().describe("Connected project ID"),
    runId: z.string().uuid().describe("Failed sync run ID"),
  },
  { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  async ({ projectId, runId }) => {
    const data = await apiFetch(`/api/v1/connected-projects/${projectId}/sync-runs/${runId}/retry`, {
      method: "POST",
    });
    return apiToolResult(data, toText);
  }
);

registerApiTool(server,
  "skip_sync_run",
  "Skip all failed jobs in a connected-project sync run, marking them completed with `skipped=true`. The run must be FAILED. " +
  "IMPORTANT: Explain which failed work will be skipped and get explicit user confirmation before calling this tool.",
  {
    projectId: z.string().uuid().describe("Connected project ID"),
    runId: z.string().uuid().describe("Failed sync run ID"),
  },
  { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  async ({ projectId, runId }) => {
    const data = await apiFetch(`/api/v1/connected-projects/${projectId}/sync-runs/${runId}/skip`, {
      method: "POST",
    });
    return apiToolResult(data, toText);
  }
);

registerApiTool(server,
  "set_connected_project_sync_mode",
  "Change a connected project's continuous-sync mode. AUTOMATIC syncs every push (and requires a Supabase backend), MANUAL syncs only when trigger_sync is called, PAUSED ignores pushes, and ARCHIVED stops syncing. " +
  "IMPORTANT: Confirm the new mode with the user before calling this tool.",
  {
    id: z.string().uuid().describe("Connected project ID"),
    syncMode: z.enum(["AUTOMATIC", "MANUAL", "PAUSED", "ARCHIVED"]).describe("New continuous-sync mode"),
  },
  { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  async ({ id, syncMode }) => {
    const data = await apiFetch(`/api/v1/connected-projects/${id}/sync-mode`, {
      method: "PATCH",
      body: JSON.stringify({ syncMode }),
    });
    return apiToolResult(data, toText);
  }
);
}
