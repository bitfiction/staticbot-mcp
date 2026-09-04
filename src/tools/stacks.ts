import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { ToolContext } from "../context.js";
import { apiToolResult, registerApiTool } from "../server/api-tool.js";

/**
 * Registered on every transport. Bodies are unchanged from the original single-file server; the only
 * difference is that apiFetch and toText now arrive per call rather than closing over module state,
 * which is what lets one registry serve both the API-key stdio server and the hosted OAuth one.
 */
export function registerStackTools(server: McpServer, { apiFetch, toText }: ToolContext): void {
// ─── Stacks ──────────────────────────────────────────────────────────────────

registerApiTool(server,
  "list_stacks",
  "List all infrastructure stacks. A stack groups one or more templates with a domain assignment. Each stack can have multiple deployments.",
  {},
  { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  async () => {
    const data = await apiFetch("/api/v1/stacks");
    return apiToolResult(data, toText);
  }
);

registerApiTool(server,
  "get_stack",
  "Get details of a stack including its templates and config overrides. Every override key is listed; values are returned for location-shaped keys (URLs, regions, names, branches) and \"[REDACTED]\" for credential-shaped ones.",
  {
    id: z.string().uuid().describe("Stack ID"),
  },
  { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  async ({ id }) => {
    const data = await apiFetch(`/api/v1/stacks/${id}`);
    return apiToolResult(data, toText);
  }
);

registerApiTool(server,
  "create_stack",
  "Create a new infrastructure stack from a template. A stack ties a template to a domain and becomes deployable. Call list_templates first to find the right templateId. Staticbot analyzes the template's repository and owns the hosting decision: static sites route to the supported AWS static target, SSR/full-stack apps route to the supported Cloudflare Workers target, and Staticbot applies the ownership model available for that flow. Do not infer or send a provider choice. Report the returned `hostingWorkload`, `deploymentTarget`, and `infrastructureOwnership` fields to the user.\n\nFor templates that use Supabase, pass supabaseIntegrationInstanceId + supabaseProjectRef. Staticbot fills and refreshes the declared Supabase configuration from the connected account; never ask the user for Supabase API keys.",
  {
    name: z.string().describe("Human-readable name for the stack (e.g. 'My Portfolio Site')"),
    templateId: z.string().uuid().describe("Template ID — get this from list_templates"),
    configOverrides: z.record(z.string()).optional().describe(
      "Non-secret key/value overrides for template config variables. See get_template for available keys. Never put passwords, tokens, private keys, or provider credentials here."
    ),
    domainOption: z.discriminatedUnion("type", [
      z.object({
        type: z.literal("AUTO_GENERATED"),
      }).describe("Let Staticbot generate a subdomain automatically (fastest, good for testing)"),
      z.object({
        type: z.literal("CUSTOM_DOMAIN"),
        domainName: z.string().describe("Your custom domain (e.g. 'example.com')"),
      }).describe("Use your own domain — you'll need to set up DNS records later"),
      z.object({
        type: z.literal("EXISTING_DOMAIN"),
        dnsDomainId: z.string().uuid().describe("ID of a DNS domain already registered in Staticbot"),
      }).describe("Reuse a domain already managed in Staticbot"),
    ]).describe("How to assign a domain to this stack"),
    supabaseIntegrationInstanceId: z.string().uuid().optional().describe(
      "Optional. Supabase integration instance ID from list_integration_instances. Combined with supabaseProjectRef, enables auto-refresh of anon keys from Supabase Management API on each deploy — you never have to manually rotate."
    ),
    supabaseProjectRef: z.string().optional().describe(
      "Optional. Supabase project reference (the subdomain part of https://<ref>.supabase.co) — get it from list_supabase_projects. Must be set together with supabaseIntegrationInstanceId to enable auto-refresh."
    ),
  },
  { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  async ({ name, templateId, configOverrides, domainOption, supabaseIntegrationInstanceId, supabaseProjectRef }) => {
    const body: Record<string, unknown> = {
      name,
      templateId,
      configOverrides: configOverrides ?? {},
      domainOption,
    };
    // Only forward picker fields when both are set — one without the other is a
    // configuration error that would leave the Stack unable to self-refresh.
    if (supabaseIntegrationInstanceId && supabaseProjectRef) {
      body.supabaseIntegrationInstanceId = supabaseIntegrationInstanceId;
      body.supabaseProjectRef = supabaseProjectRef;
    }
    const data = await apiFetch("/api/v1/stacks", {
      method: "POST",
      body: JSON.stringify(body),
    });
    return apiToolResult(data, toText);
  }
);
}
