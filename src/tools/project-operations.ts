import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ToolContext } from "../context.js";
import { apiToolResult, registerApiTool } from "../server/api-tool.js";

export function registerProjectOperationTools(server: McpServer, { apiFetch, toText }: ToolContext): void {
  registerApiTool(server,
    "get_connected_project_operations",
    "Inspect a connected project's current builder/live branch targets, effective permissions, " +
      "and repository webhook scope, including other projects/templates sharing that webhook. " +
      "Read this before proposing a preview build, live-branch switch, sync-to-live or webhook change. " +
      "Permission flags are role permissions; feature flags and current workflow state can still block an action. " +
      "Reading does not fetch Git or change a repository, webhook or deployment. Contains no webhook secret.",
    { id: z.string().uuid().describe("Connected project ID") },
    { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    async ({ id }) => apiToolResult(await apiFetch(`/api/v1/connected-projects/${id}/operations`), toText),
  );

  registerApiTool(server,
    "build_connected_project_preview",
    "Build or refresh the project's live-tracking branch preview. Inspect get_connected_project_operations " +
      "and obtain explicit approval first: this can provision preview infrastructure and replace an " +
      "existing preview. A queued response is not success; monitor list_connected_project_previews " +
      "and get_deployment. This does not itself approve or promote production.",
    { id: z.string().uuid(), confirmed: z.literal(true).describe("True only after explicit approval of this preview build") },
    { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    async ({ id, confirmed }) => apiToolResult(await apiFetch(`/api/v1/connected-projects/${id}/build-preview`, {
      method: "POST", body: JSON.stringify({ confirmed }),
    }), toText),
  );

  registerApiTool(server,
    "switch_connected_project_migration_backend",
    "Explicitly switch this app's project to a completed migration's backend, including its sync credentials. " +
      "Inspect the project and migration first and obtain approval naming the target backend. " +
      "The previous migration must be archived and no sync may be active. " +
      "The live build stays as it is until a new preview is verified and promoted.",
    {
      id: z.string().uuid().describe("Connected project ID"),
      migrationId: z.string().uuid().describe("Completed migration of this project's app"),
      confirmed: z.literal(true).describe("True only after approval of the named backend switch"),
    },
    { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    async ({ id, migrationId }) => apiToolResult(await apiFetch(`/api/v1/connected-projects/${id}/migration-backend`, {
      method: "POST", body: JSON.stringify({ migrationId }),
    }), toText),
  );

  const branchInput = {
    id: z.string().uuid().describe("Connected project ID"),
    confirmed: z.literal(true).describe("True only after explicit approval of the named branch targets and consequences"),
    expectedLiveBranch: z.string().min(1).describe("Exact liveBranch just inspected via get_connected_project_operations"),
    expectedBuilderBranch: z.string().min(1).describe("Exact builderBranch just inspected via get_connected_project_operations"),
  };
  registerApiTool(server,
    "switch_connected_project_live_branch",
    "Switch live deployment to the project's existing builder branch (cut the cord). This stops " +
      "maintaining the Staticbot mirror and can redeploy the production site. It is not an arbitrary " +
      "branch picker, and no reverse action is exposed. Inspect get_connected_project_operations, " +
      "explain the exact current and target branches and obtain explicit approval before confirmed=true. " +
      "Forward both branch names verbatim. On a 409 inspect again and obtain fresh approval; never " +
      "substitute new targets automatically. A branch switch can succeed while redeployment fails: " +
      "report the returned message and redeployed flag accurately.",
    branchInput,
    { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    async ({ id, ...body }) => apiToolResult(await apiFetch(`/api/v1/connected-projects/${id}/live-branch`, {
      method: "POST", body: JSON.stringify(body),
    }), toText),
  );
  registerApiTool(server,
    "sync_connected_project_to_live",
    "Check and merge the migration preview branch onto the project's live mirror branch, creating " +
      "the mirror if missing. This can write Git commits and trigger builds. Inspect project operations " +
      "and branch previews first; explain the preview-to-live merge and obtain explicit approval. " +
      "Forward the inspected live and builder branch names; a 409 requires fresh inspection and approval. " +
      "The backend refuses merging into the builder branch and retains its feature/eligibility guards. " +
      "A 202 may return an already-running runId: monitor get_sync_run/get_sync_run_jobs rather than " +
      "queueing another action or claiming the merge or deployment finished.",
    branchInput,
    { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    async ({ id, ...body }) => apiToolResult(await apiFetch(`/api/v1/connected-projects/${id}/sync-to-live`, {
      method: "POST", body: JSON.stringify(body),
    }), toText),
  );

  for (const [name, endpoint, consequence, destructive] of [
    ["setup_connected_project_webhook", "setup-webhook", "Register the repository's GitHub webhook so pushes can trigger sync and preview builds.", false],
    ["reset_connected_project_webhook", "reset-webhook", "Replace the repository's GitHub webhook and rotate its internal secret; this affects push-triggered automation.", true],
    ["disable_connected_project_webhook", "disable-webhook", "Clear the repository's webhook configuration and request upstream deletion; pushes stop triggering its Staticbot automation.", true],
  ] as const) {
    registerApiTool(server, name,
      consequence + " First inspect get_connected_project_operations and show every affected project " +
      "and the template count sharing the repository webhook. Obtain explicit approval for that scope " +
      "before confirmed=true. Copy webhook.repositoryConfigId to expectedRepositoryConfigId; do not " +
      "invent it. On changed-target 409 inspect and ask again. This supports GitHub only, and agency " +
      "client projects must use the source project's webhook. Secrets remain server-side. Reset and " +
      "disable use best-effort upstream deletion: remoteDeletionVerified=false is not proof that " +
      "GitHub removed the previous hook. Preserve that limitation and the returned message.",
      { id: z.string().uuid(), confirmed: z.literal(true).describe("Explicit approval of the inspected shared webhook scope"),
        expectedRepositoryConfigId: z.string().uuid().describe("Exact webhook.repositoryConfigId returned by project operations") },
      { readOnlyHint: false, destructiveHint: destructive, openWorldHint: true },
      async ({ id, ...body }) => apiToolResult(await apiFetch(`/api/v1/connected-projects/${id}/${endpoint}`, {
        method: "POST", body: JSON.stringify(body),
      }), toText),
    );
  }
}
