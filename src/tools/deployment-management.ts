import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { ToolContext } from "../context.js";
import { apiToolResult, registerApiTool } from "../server/api-tool.js";

/**
 * Registered on every transport. Bodies are unchanged from the original single-file server; the only
 * difference is that apiFetch and toText now arrive per call rather than closing over module state,
 * which is what lets one registry serve both the API-key stdio server and the hosted OAuth one.
 */
export function registerDeploymentManagementTools(server: McpServer, { apiFetch, toText }: ToolContext): void {
// ─── Deployment management ─────────────────────────────────────────────

registerApiTool(server,
  "get_auto_deploy_settings",
  "Get the automatic-update flags for a deployment. `autoDeployLatestWebsite` controls whether a new website template version is deployed automatically; `autoDeployLatestInfra` is reserved for infrastructure updates.",
  {
    id: z.string().uuid().describe("Deployment ID"),
  },
  { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  async ({ id }) => {
    const data = await apiFetch(`/api/v1/deployments/${id}/auto-deploy-settings`);
    return apiToolResult(data, toText);
  }
);

registerApiTool(server,
  "update_auto_deploy_settings",
  "Update automatic-update flags for a deployment. Omitted fields keep their current values. " +
  "IMPORTANT: Confirm the requested settings with the user before calling this tool.",
  {
    id: z.string().uuid().describe("Deployment ID"),
    autoDeployLatestWebsite: z.boolean().optional().describe("Enable or disable automatic deployment of new website template versions"),
    autoDeployLatestInfra: z.boolean().optional().describe("Enable or disable automatic infrastructure template updates (reserved for future use)"),
  },
  { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  async ({ id, autoDeployLatestWebsite, autoDeployLatestInfra }) => {
    const body: Record<string, boolean> = {};
    if (autoDeployLatestWebsite !== undefined) body.autoDeployLatestWebsite = autoDeployLatestWebsite;
    if (autoDeployLatestInfra !== undefined) body.autoDeployLatestInfra = autoDeployLatestInfra;
    const data = await apiFetch(`/api/v1/deployments/${id}/auto-deploy-settings`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
    return apiToolResult(data, toText);
  }
);

registerApiTool(server,
  "get_auto_deploy_info",
  "Check whether Automatic Updates are available for a deployment and inspect its GitHub webhook state. Returns fields including `available`, `webhookConfigured`, `canSetupWebhook`, and `isGithubRepo`. Automatic Updates do not apply to preview stacks.",
  {
    id: z.string().uuid().describe("Deployment ID"),
  },
  { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  async ({ id }) => {
    const data = await apiFetch(`/api/v1/deployments/${id}/auto-deploy-info`);
    return apiToolResult(data, toText);
  }
);

registerApiTool(server,
  "list_rollback_versions",
  "List the recent commit-pinned website template versions that are valid rollback targets for a deployment, newest first. Use only a returned `templateId` with rollback_website; do not infer a target from a commit SHA or version label.",
  {
    id: z.string().uuid().describe("Deployment ID"),
  },
  { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  async ({ id }) => {
    const data = await apiFetch(`/api/v1/deployments/${id}/rollback-versions`);
    return apiToolResult(data, toText);
  }
);

registerApiTool(server,
  "rollback_website",
  "Roll a static website back to a specific commit-pinned template version. Call list_rollback_versions first. " +
  "IMPORTANT: Present the exact returned target version and commit to the user and get explicit confirmation before calling this tool. Never supply an inferred or unverified template ID. " +
  "Returns the worker job ID; poll get_deployment to track progress.",
  {
    id: z.string().uuid().describe("Deployment ID"),
    templateId: z.string().uuid().describe("Target template version ID from list_rollback_versions"),
  },
  { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
  async ({ id, templateId }) => {
    const data = await apiFetch(
      `/api/v1/deployments/${id}/rollback-website?templateId=${encodeURIComponent(templateId)}`,
      { method: "POST" }
    );
    return apiToolResult(data, toText);
  }
);

registerApiTool(server,
  "redeploy_website",
  "Rebuild and redeploy the static website component. By default it redeploys the currently pinned template version; set `useLatest=true` to pull the latest version first. Returns the worker job ID; poll get_deployment to track progress.",
  {
    id: z.string().uuid().describe("Deployment ID"),
    useLatest: z.boolean().optional().describe("Pull the latest website template version before redeploying (default: false)"),
  },
  { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
  async ({ id, useLatest }) => {
    const data = await apiFetch(
      `/api/v1/deployments/${id}/redeploy-website?useLatest=${useLatest ?? false}`,
      { method: "POST" }
    );
    return apiToolResult(data, toText);
  }
);
registerApiTool(server,
  "abort_deployment",
  "Abort a deployment that is running: its current job stops and the deployment settles as aborted; resources " +
  "it already created stay. Read get_deployment first, confirm with the user, then pass confirmed=true. A 409 " +
  "means the deployment is not running (the message says its state).",
  {
    id: z.string().uuid().describe("Deployment ID"),
    confirmed: z.literal(true).describe("True only after the user confirmed the abort"),
  },
  { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
  async ({ id, confirmed }) => {
    const data = await apiFetch(`/api/v1/deployments/${id}/abort`, {
      method: "POST", body: JSON.stringify({ confirmed }),
    });
    return apiToolResult(data, toText);
  }
);

registerApiTool(server,
  "destroy_deployment",
  "IRREVERSIBLE: destroy a deployment's cloud resources (hosting, CDN and the DNS records it created). For a " +
  "connected project's live deployment this takes the live site down. Read get_deployment first, tell the user " +
  "what will be removed (stack, domains, status), get an explicit yes, then pass confirmed=true and " +
  "expectedStatus = the status the user saw. A 409 means the status changed or does not allow destroying: read " +
  "the deployment again and ask again. Needs workspace administrator rights. Follow progress with get_deployment.",
  {
    id: z.string().uuid().describe("Deployment ID"),
    confirmed: z.literal(true).describe("True only after the user explicitly approved destroying it"),
    expectedStatus: z.string().min(1).describe("The deployment status from get_deployment that the user saw"),
  },
  { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
  async ({ id, confirmed, expectedStatus }) => {
    const data = await apiFetch(`/api/v1/deployments/${id}/destroy`, {
      method: "POST", body: JSON.stringify({ confirmed, expectedStatus }),
    });
    return apiToolResult(data, toText);
  }
);
}
