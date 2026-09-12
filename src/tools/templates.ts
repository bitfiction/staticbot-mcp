import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { ToolContext } from "../context.js";
import { apiToolResult, registerApiTool } from "../server/api-tool.js";

/**
 * Registered on every transport. Bodies are unchanged from the original single-file server; the only
 * difference is that apiFetch and toText now arrive per call rather than closing over module state,
 * which is what lets one registry serve both the API-key stdio server and the hosted OAuth one.
 */
export function registerTemplateTools(server: McpServer, { apiFetch, toText }: ToolContext): void {
// ─── Templates ───────────────────────────────────────────────────────────────

registerApiTool(server,
  "list_templates",
  "List available templates (slim response: id, name, category, repoLink). " +
  "Use get_template to see full details including config variables. " +
  "When preparing a migration, reuse an exact repository match when one exists. Otherwise create a new template " +
  "from the repository resolved through list_source_repositories. Ask the user to choose only when multiple " +
  "existing templates or repositories are plausible — and when two repositories share a name, show which account " +
  "each is hosted in (sourceLabel) so the choice is meaningful.",
  {},
  { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  async () => {
    const data = await apiFetch("/api/v1/templates");
    return apiToolResult(data, toText);
  }
);

registerApiTool(server,
  "get_template",
  "Get details of a template including its backend-classified configuration variables. Each entry has `key`, `configured` (whether a value is set at all), and sanitized `value`. Staticbot never returns credential values, so read `configured` to tell \"withheld\" apart from \"not set\". For migrations, follow `migrationAction`, `collectionStage`, `sensitivity`, `resolution`, `integration`, and `migrationHint`; do not infer meaning or safety from prefixes. Include a configOverride only when `migrationEditable=true`. `migrationBackendDerived=true` means Staticbot derives the value from target state and user input cannot take precedence. `SECURITY_REVIEW` means stop and explain the client-exposure finding; `REVIEW_CONFIGURATION` means the variable needs an explicit template annotation. Never request either as a configOverride. `CONFIGURE_INTEGRATION` is follow-up work, not a migration-creation input.",
  {
    id: z.string().uuid().describe("Template ID"),
  },
  { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  async ({ id }) => {
    const data = await apiFetch(`/api/v1/templates/${id}`);
    return apiToolResult(data, toText);
  }
);

registerApiTool(server,
  "create_template",
  "Create a new template by scanning a source repository (GitHub or GitLab). Auto-detects platforms, env vars, and builders. " +
  "Both public and private repositories are supported through the organization's connected Staticbot source-control integration. " +
  "Before asking the user for a URL, call list_source_repositories and use an unambiguous repository match from " +
  "the current client/project context, passing that repository's integrationInstanceId as " +
  "sourceControlIntegrationInstanceId — with several accounts connected, only that one's token can read the repo, " +
  "and omitting it makes a private repository look missing. If no source-control integration is connected, direct " +
  "the user to https://app.staticbot.dev/integrations and retry after they connect it. Never claim the repository must be public. " +
  "Staticbot also classifies the repository's hosting workload; inspect the returned `hostingWorkload` and `isSsr` fields instead of choosing AWS or Cloudflare from agent-side heuristics. " +
  "Use this when the user wants to migrate a repo that doesn't match any existing template from list_templates. " +
  "The name is optional — if omitted, it's derived from the repo name.",
  {
    repoLink: z.string().describe("Repository URL (public or private; e.g. https://github.com/owner/repo or https://gitlab.com/group/project). Resolve it with list_source_repositories when a source-control integration is connected."),
    name: z.string().optional().describe("Template name (derived from repo name if omitted)"),
    sourceControlIntegrationInstanceId: z.string().uuid().optional().describe("The repository's integrationInstanceId from list_source_repositories — the account it is hosted in. Pass it whenever the repo came from discovery: with several accounts connected on one provider, only that account's token can read it."),
  },
  { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  async ({ repoLink, name, sourceControlIntegrationInstanceId }) => {
    const body: Record<string, string> = { repoLink };
    if (name) body.name = name;
    if (sourceControlIntegrationInstanceId) {
      body.sourceControlIntegrationInstanceId = sourceControlIntegrationInstanceId;
    }
    const data = await apiFetch("/api/v1/templates", {
      method: "POST",
      body: JSON.stringify(body),
    });
    return apiToolResult(data, toText);
  }
);

}
