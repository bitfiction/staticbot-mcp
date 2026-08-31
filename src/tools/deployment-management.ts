import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { ToolContext } from "../context.js";

/**
 * Registered on every transport. Bodies are unchanged from the original single-file server; the only
 * difference is that apiFetch and toText now arrive per call rather than closing over module state,
 * which is what lets one registry serve both the API-key stdio server and the hosted OAuth one.
 */
export function registerDeploymentManagementTools(server: McpServer, { apiFetch, toText }: ToolContext): void {
// ─── Deployment management ─────────────────────────────────────────────

server.tool(
  "get_auto_deploy_settings",
  "Get the automatic-update flags for a deployment. `autoDeployLatestWebsite` controls whether a new website template version is deployed automatically; `autoDeployLatestInfra` is reserved for infrastructure updates.",
  {
    id: z.string().uuid().describe("Deployment ID"),
  },
  { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  async ({ id }) => {
    const data = await apiFetch(`/api/v1/deployments/${id}/auto-deploy-settings`);
    return { content: [{ type: "text", text: toText(data) }] };
  }
);

server.tool(
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
    return { content: [{ type: "text", text: toText(data) }] };
  }
);

server.tool(
  "get_auto_deploy_info",
  "Check whether Automatic Updates are available for a deployment and inspect its GitHub webhook state. Returns fields including `available`, `webhookConfigured`, `canSetupWebhook`, and `isGithubRepo`. Automatic Updates do not apply to preview stacks.",
  {
    id: z.string().uuid().describe("Deployment ID"),
  },
  { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  async ({ id }) => {
    const data = await apiFetch(`/api/v1/deployments/${id}/auto-deploy-info`);
    return { content: [{ type: "text", text: toText(data) }] };
  }
);

server.tool(
  "list_rollback_versions",
  "List the recent commit-pinned website template versions that are valid rollback targets for a deployment, newest first. Use only a returned `templateId` with rollback_website; do not infer a target from a commit SHA or version label.",
  {
    id: z.string().uuid().describe("Deployment ID"),
  },
  { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  async ({ id }) => {
    const data = await apiFetch(`/api/v1/deployments/${id}/rollback-versions`);
    return { content: [{ type: "text", text: toText(data) }] };
  }
);

server.tool(
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
    return { content: [{ type: "text", text: toText(data) }] };
  }
);

server.tool(
  "redeploy_website",
  "Rebuild and redeploy the static website component. By default it redeploys the currently pinned template version; set `useLatest=true` to pull the latest version first. Returns the worker job ID; poll get_deployment to track progress.",
  {
    id: z.string().uuid().describe("Deployment ID"),
    useLatest: z.boolean().optional().describe("Pull the latest website template version before redeploying (default: false)"),
  },
  { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  async ({ id, useLatest }) => {
    const data = await apiFetch(
      `/api/v1/deployments/${id}/redeploy-website?useLatest=${useLatest ?? false}`,
      { method: "POST" }
    );
    return { content: [{ type: "text", text: toText(data) }] };
  }
);
}
