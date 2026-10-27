import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ToolContext } from "../context.js";
import { apiToolResult, registerApiTool } from "../server/api-tool.js";

const selector = {
  connectedProjectId: z.string().uuid().optional().describe("Connected project ID; provide exactly one selector"),
  migrationId: z.string().uuid().optional().describe("Migration ID; provide exactly one selector"),
};
function backendPath({ connectedProjectId, migrationId }: { connectedProjectId?: string; migrationId?: string }): string {
  if (Boolean(connectedProjectId) === Boolean(migrationId)) throw new Error("Provide exactly one of connectedProjectId or migrationId");
  return connectedProjectId ? `/api/v1/connected-projects/${connectedProjectId}/backend` : `/api/v1/migrations/${migrationId}/backend`;
}

export function registerBackendOperationTools(server: McpServer, { apiFetch, toText }: ToolContext): void {
  registerApiTool(server, "get_backend_workflows",
    "Inspect the migrated backend's environments, workflow state, availableActions, blockers and recorded outcomes. " +
    "Show all stages sharing the backend, including live stages: preview and production can share one database. " +
    "Controls currently apply only to Staticbot's migrated Base44 scheduler on Supabase Cloud. " +
    "Copy the returned environment id, projectRef, activated and tickActive before proposing an action. " +
    "Reading does not activate, deactivate, defer or attest verification. No SQL or credential values are returned.",
    selector, { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    async args => apiToolResult(await apiFetch(backendPath(args)), toText));

  registerApiTool(server, "operate_backend_workflows",
    "Perform an explicitly approved availableAction on the exact shared backend inspected with get_backend_workflows. " +
    "ACTIVATE enables scheduled/record-change workflows and can cause external effects; DEACTIVATE stops that " +
    "dispatcher, not direct app calls. DEFER records a decision without disabling an active scheduler or scheduling " +
    "future activation. VERIFY records approval of the observed state after an unverified request; it does not " +
    "prove application flows work. Explain every affected stage and obtain approval for the exact action and target. " +
    "Forward observed flags verbatim, including null. A 409 requires fresh inspection and approval. " +
    "Preserve UNVERIFIED outcomes as unknown: never retry a timed-out mutation automatically or bypass blockers.",
    { ...selector, environmentId: z.string().min(1), expectedProjectRef: z.string().min(1),
      action: z.enum(["ACTIVATE", "DEACTIVATE", "DEFER", "VERIFY"]),
      expectedActivated: z.boolean().nullable(), expectedTickActive: z.boolean().nullable(),
      confirmed: z.literal(true).describe("Explicit approval of the inspected backend, shared scope and action") },
    { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    async ({ connectedProjectId, migrationId, ...body }) => apiToolResult(await apiFetch(
      `${backendPath({ connectedProjectId, migrationId })}/workflows`, { method: "POST", body: JSON.stringify(body) }), toText));

  registerApiTool(server, "get_feature_branch_preview_settings",
    "Inspect automatic feature-branch previews, hosting-plan eligibility and preview limits. The live branch has " +
    "a separate preview. Also inspect list_connected_project_previews for tracked branches and each build hint " +
    "before offering a branch build. Reading never changes settings or provisions a preview.",
    { id: z.string().uuid() }, { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    async ({ id }) => apiToolResult(await apiFetch(`/api/v1/connected-projects/${id}/feature-branch-previews`), toText));

  registerApiTool(server, "set_feature_branch_preview_settings",
    "Enable or disable automatic previews for pushed feature branches after the user approves that exact setting. " +
    "Inspect get_feature_branch_preview_settings first and explain plan limits: enabling can provision resources " +
    "and remove older feature previews to stay within the limit. Existing previews may continue following pushes. " +
    "Enabling requires an eligible hosting plan; disabling is available without upgrading. Never change billing " +
    "or switch this setting merely to bypass a refusal.",
    { id: z.string().uuid(), enabled: z.boolean(), confirmed: z.literal(true) },
    { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    async ({ id, ...body }) => apiToolResult(await apiFetch(`/api/v1/connected-projects/${id}/feature-branch-previews`,
      { method: "PUT", body: JSON.stringify(body) }), toText));

  registerApiTool(server, "build_feature_branch_preview",
    "Build a tracked non-live branch preview after explicit approval. First read list_connected_project_previews " +
    "and get_feature_branch_preview_settings; show the branch, lastCommitSha and its build.hint, especially any " +
    "other preview removed by the plan limit. Copy lastCommitSha to expectedCommitSha and build.hint to " +
    "expectedBuildHint verbatim. A changed commit/hint or unavailable build returns 409: inspect and obtain fresh " +
    "approval rather than replacing the targets automatically. A 202 only queues work; monitor previews and " +
    "get_deployment. For the live branch use build_connected_project_preview.",
    { id: z.string().uuid(), branch: z.string().min(1), expectedCommitSha: z.string().min(1),
      expectedBuildHint: z.string().min(1), confirmed: z.literal(true) },
    { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    async ({ id, ...body }) => apiToolResult(await apiFetch(`/api/v1/connected-projects/${id}/branches/preview`,
      { method: "POST", body: JSON.stringify(body) }), toText));

  registerApiTool(server, "preview_migration_source_update",
    "Resolve a selected template version to an exact source commit and preview a migration re-prepare. " +
    "Returns only template/version/commit/ref and a notice; does not apply a new pin, replace the plan, approve " +
    "or resume execution. Check executionCompatibility first. Present the returned exact templateId and " +
    "commitSha and the loss of the previous plan approval before proposing update_migration_source. " +
    "Eligibility and feature-flag refusals remain refusals; never guess the commit or choose another version automatically.",
    { id: z.string().uuid(), templateId: z.string().uuid() },
    { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    async ({ id, templateId }) => apiToolResult(await apiFetch(`/api/v1/migrations/${id}/source-update?templateId=${templateId}`), toText));

  registerApiTool(server, "update_migration_source",
    "Re-prepare a not-yet-executed migration from the exact template version and commit inspected using " +
    "preview_migration_source_update. Explain that this replaces the prepared plan and invalidates its approval, " +
    "obtain explicit approval for that exact pair and send it verbatim with confirmed=true. Saved field decisions " +
    "are retained for revalidation. A stale-version 409 requires fresh preview and approval, never automatic " +
    "commit substitution. This does not approve target writes. Poll get_migration_overview, inspect the new " +
    "discovery report and obtain separate execution approval. Never bypass an execution lock or re-prepare after writes began.",
    { id: z.string().uuid(), templateId: z.string().uuid(), expectedCommitSha: z.string().regex(/^[0-9a-fA-F]{40}$/),
      confirmed: z.literal(true) },
    { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    async ({ id, ...body }) => apiToolResult(await apiFetch(`/api/v1/migrations/${id}/source-update`,
      { method: "POST", body: JSON.stringify(body) }), toText));

  registerApiTool(server, "get_external_auth_domain",
    "Inspect authentication configuration for a frontend hosted outside Staticbot. Returns targetSupabaseUrl " +
    "and authentication eligibility, origin, worker status, errors and changed secret names only. " +
    "UPDATED means configuration readback passed, not that login, password reset or magic links were tested. " +
    "Reading does not change hosting, DNS, authentication or secret values.",
    { id: z.string().uuid() }, { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    async ({ id }) => apiToolResult(await apiFetch(`/api/v1/connected-projects/${id}/hosting/auth-domain`), toText));

  registerApiTool(server, "set_external_auth_domain",
    "Configure the Supabase authentication origin for an externally hosted frontend. Inspect get_external_auth_domain, " +
    "show its exact backend and the public hostname the user supplied, explain that authentication URLs and known " +
    "base-URL secrets change server-side, and obtain explicit approval. Copy targetSupabaseUrl verbatim to " +
    "expectedTargetSupabaseUrl. Use an exact public hostname or HTTPS origin without path, query, wildcard, " +
    "port or credentials. This does not deploy/move the frontend or change DNS. Poll get_external_auth_domain; " +
    "preserve pending/failed/unverified results. Even UPDATED requires real login/reset/magic-link tests. " +
    "On changed-target 409 inspect and ask again; never bypass concurrent-operation guards or request secret values.",
    { id: z.string().uuid(), hostname: z.string().trim().min(1).max(263),
      expectedTargetSupabaseUrl: z.string().url(), confirmed: z.literal(true) },
    { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    async ({ id, ...body }) => apiToolResult(await apiFetch(`/api/v1/connected-projects/${id}/hosting/auth-domain`,
      { method: "POST", body: JSON.stringify(body) }), toText));
}
