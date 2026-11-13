import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolContext } from "../context.js";
import { apiToolResult, registerApiTool } from "../server/api-tool.js";

export function registerProjectLaunchTools(server: McpServer, { apiFetch, toText }: ToolContext): void {
  registerApiTool(server,
    "get_connected_project_launch",
    "Inspect the first hosting launch of a connected project using an attached release template. Returns plan " +
      "with the exact templateVersion and stateVersion, existingStackId, backendUrl, migration/backend availability and " +
      "sign-in choices, plus available owned domains. Present the domain, useMigratedBackend and sign-in choices " +
      "before asking for approval. projectBackendRequired means a client project must keep its connected backend. " +
      "If existingStackId is set, continue with that hosting instead of creating " +
      "another stack. Does not create hosting, start a deployment or change sign-in settings.",
    { id: z.string().uuid().describe("Connected project ID"), templateId: z.string().uuid().describe("Attached release template ID") },
    { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    async ({ id, templateId }) => apiToolResult(await apiFetch(
      `/api/v1/connected-projects/${id}/hosting/launch?templateId=${encodeURIComponent(templateId)}`), toText),
  );

  registerApiTool(server,
    "launch_connected_project",
    "Configure a connected project's first hosting launch after get_connected_project_launch and explicit " +
      "approval of the domain, backend and sign-in choices. Copy plan.templateVersion and plan.stateVersion " +
      "unchanged. AUTO_GENERATED assigns a new hostname; CUSTOM_DOMAIN takes domainName; EXISTING_DOMAIN takes " +
      "a dnsDomainId from the inspection. useMigratedBackend must be an explicit choice; true uses the stored " +
      "migration backend (or the required client-project backend) without taking any keys. When " +
      "projectBackendRequired is true it must be true. Include signInPage when the plan requires it. Cloudflare " +
      "choice comes from list_cloudflare_hosting_targets. Links the new stack to the project and its Live " +
      "pipeline stage. CONFIGURED means hosting setup only: no deployment was created or started. Use the " +
      "returned stackId with create_deployment and start_deployment separately. A 409 requires fresh inspection " +
      "and approval. Never retry an unknown outcome or substitute a new plan automatically.",
    {
      id: z.string().uuid().describe("Connected project ID"),
      templateId: z.string().uuid().describe("Release template ID the user inspected"),
      templateVersion: z.string().min(1).describe("Exact plan.templateVersion"),
      domainOption: z.object({
        type: z.enum(["AUTO_GENERATED", "CUSTOM_DOMAIN", "EXISTING_DOMAIN"]),
        domainName: z.string().min(1).optional().describe("CUSTOM_DOMAIN only"),
        dnsDomainId: z.string().uuid().optional().describe("EXISTING_DOMAIN only; from the available domains"),
      }),
      useMigratedBackend: z.boolean().describe("The user's explicit choice to use the stored migrated backend or preserve repository settings"),
      signInPage: z.enum(["APP", "STATICBOT"]).optional().describe("The user's sign-in page choice when offered/required"),
      cloudflareChoice: z.string().min(1).optional().describe("Optional exact Cloudflare hosting choice from its picker"),
      expectedState: z.string().regex(/^[0-9a-f]{64}$/).describe("Exact plan.stateVersion the user approved"),
      confirmed: z.literal(true).describe("True only after explicit approval of these launch choices"),
    },
    { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    async ({ id, ...body }) => apiToolResult(await apiFetch(`/api/v1/connected-projects/${id}/hosting/launch`, {
      method: "POST", body: JSON.stringify(body),
    }), toText),
  );
}
