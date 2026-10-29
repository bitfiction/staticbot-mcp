import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ToolContext } from "../context.js";
import { apiToolResult, registerApiTool } from "../server/api-tool.js";

const id = z.string().uuid().describe("Connected project ID");
const expectedState = z.string().regex(/^[0-9a-f]{64}$/).describe(
  "Exact stateVersion from the cutover inspection the user approved; never invent or refresh it silently",
);

export function registerCutoverTools(server: McpServer, { apiFetch, toText }: ToolContext): void {
  registerApiTool(server, "get_connected_project_cutover",
    "Read retained Switch-tab evidence: whether the live app was observed on its migrated backend, late source " +
    "changes, copy options, conflicts and exact source/target/copy-window scope. This never scans, checks, copies " +
    "or marks conflicts reviewed. Unknown or truncated evidence is not proof that the source is quiet. " +
    "Counts describe source writes, not confirmed missing target data. Present source, targetProjectRef, " +
    "copiedThrough, copyFinishedAt and the selected mode's confirmation before proposing a copy. " +
    "stateVersion is an optimistic snapshot, not approval or an authorization credential.",
    { id }, { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    async ({ id }) => apiToolResult(await apiFetch(`/api/v1/connected-projects/${id}/cutover`), toText));

  registerApiTool(server, "check_connected_project_cutover",
    "Check the live website and old backend for changes after migration. Starts a guarded website scan, " +
    "reads bounded source timestamps/new accounts and records evidence; configured workspace notifications " +
    "may be sent. Never copies data or resolves conflicts. Poll get_connected_project_cutover while checking. " +
    "Preserve unknown, unreadable, incomplete and access-blocked results. The check does not cover deletions, " +
    "files, existing account changes or external systems, and cannot bypass a target website's access controls.",
    { id }, { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    async ({ id }) => apiToolResult(await apiFetch(`/api/v1/connected-projects/${id}/cutover/check`,
      { method: "POST" }), toText));

  registerApiTool(server, "copy_connected_project_late_changes",
    "Copy late Base44 changes into the project's migrated Supabase after explicit user approval. First inspect " +
    "get_connected_project_cutover, present the exact source, targetProjectRef, copiedThrough/copyFinishedAt " +
    "and selected copy option's confirmation, and copy stateVersion verbatim to expectedState. " +
    "INSERT_ONLY leaves differing target records for review. FULL_UPDATE overwrites them with current Base44 " +
    "values, including changes made in Supabase. The worker reads current source records after the approved " +
    "lower bound, not a frozen set of the observed rows. Missing accounts may be created and need password " +
    "resets; existing accounts are unchanged, nothing is deleted, and webhooks/API clients are not moved. " +
    "A 409 requires fresh inspection and fresh approval; never replace expectedState automatically. " +
    "A 202 only queues work: follow get_sync_run and inspect cutover results. Never retry a timed-out or " +
    "unknown outcome automatically, and never mark conflicts reviewed merely because the copy completed.",
    { id, mode: z.enum(["INSERT_ONLY", "FULL_UPDATE"]), expectedState,
      confirmed: z.literal(true).describe("Explicit approval of this source, target, copy window and selected mode") },
    { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    async ({ id, ...body }) => apiToolResult(await apiFetch(`/api/v1/connected-projects/${id}/cutover/copy`,
      { method: "POST", body: JSON.stringify(body) }), toText));

  registerApiTool(server, "mark_cutover_conflicts_reviewed",
    "Record that the user reviewed and settled the exact last copy's conflicts, or deliberately kept Supabase's " +
    "versions. Inspect get_connected_project_cutover, present the copy run, conflicts, copy window and " +
    "copy.reviewConfirmation, and obtain explicit confirmation that the conflicts were handled. If " +
    "conflictsTruncated is true, the user must review the remaining conflicts in the dashboard; never treat " +
    "a partial list as complete. Forward " +
    "stateVersion verbatim as expectedState. This advances Staticbot's watch window past that copy; " +
    "it does not merge, repair or verify database records. Never attest review on the user's behalf or chain " +
    "this automatically after a copy. A changed-state 409 requires fresh inspection and approval. " +
    "Never retry a timed-out or unknown outcome automatically.",
    { id, expectedState, confirmed: z.literal(true).describe("The user explicitly confirmed review of this copy's conflicts") },
    { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    async ({ id, ...body }) => apiToolResult(await apiFetch(`/api/v1/connected-projects/${id}/cutover/conflicts/reviewed`,
      { method: "POST", body: JSON.stringify(body) }), toText));
}
