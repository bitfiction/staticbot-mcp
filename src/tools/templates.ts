import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { ToolContext } from "../context.js";

/**
 * Registered on every transport. Bodies are unchanged from the original single-file server; the only
 * difference is that apiFetch and toText now arrive per call rather than closing over module state,
 * which is what lets one registry serve both the API-key stdio server and the hosted OAuth one.
 */
export function registerTemplateTools(server: McpServer, { apiFetch, toText }: ToolContext): void {
// ─── Templates ───────────────────────────────────────────────────────────────

server.tool(
  "list_templates",
  "List available templates (slim response: id, name, category, repoLink). " +
  "Use get_template to see full details including config variables. " +
  "When preparing a migration, ask the user: do they want to pick an existing template from this list, " +
  "or create a new one from their GitHub repo using create_template?",
  {},
  async () => {
    const data = await apiFetch("/api/v1/templates");
    return { content: [{ type: "text", text: toText(data) }] };
  }
);

server.tool(
  "get_template",
  "Get details of a template including its configuration variables. Use this to see what configOverrides are available when creating a stack. The configVariables field lists environment variables the template supports (e.g. VITE_SUPABASE_URL).",
  {
    id: z.string().uuid().describe("Template ID"),
  },
  async ({ id }) => {
    const data = await apiFetch(`/api/v1/templates/${id}`);
    return { content: [{ type: "text", text: toText(data) }] };
  }
);

server.tool(
  "create_template",
  "Create a new template by scanning a GitHub repository. Auto-detects platforms, env vars, and builders. " +
  "Staticbot also classifies the repository's hosting workload; inspect the returned `hostingWorkload` and `isSsr` fields instead of choosing AWS or Cloudflare from agent-side heuristics. " +
  "Use this when the user wants to migrate a repo that doesn't match any existing template from list_templates. " +
  "The name is optional — if omitted, it's derived from the repo name.",
  {
    repoLink: z.string().describe("GitHub repository URL (e.g. https://github.com/owner/repo)"),
    name: z.string().optional().describe("Template name (derived from repo name if omitted)"),
  },
  async ({ repoLink, name }) => {
    const body: Record<string, string> = { repoLink };
    if (name) body.name = name;
    const data = await apiFetch("/api/v1/templates", {
      method: "POST",
      body: JSON.stringify(body),
    });
    return { content: [{ type: "text", text: toText(data) }] };
  }
);

server.tool(
  "scan_deployed_url",
  "Scan a deployed Base44 app URL for inlined Supabase credentials. " +
  "Vite bakes import.meta.env.VITE_* into the JS bundle at build time. For Base44 users " +
  "whose GitHub .env only has placeholders (or for BASE44_SUPABASE migrations where " +
  "parse_source_keys returns empty values), this tool fetches the deployed *.base44.app HTML, " +
  "finds /assets/index-*.js, and regex-extracts the Supabase URL + anon key. " +
  "Restricted to *.base44.app hosts. Use the returned supabaseUrl and supabaseAnonKey " +
  "as sourceSupabaseUrl and sourceSupabaseAnonKey in create_migration.",
  {
    deployedUrl: z.string().describe("Deployed Base44 app URL (e.g. https://myapp.base44.app)"),
  },
  async ({ deployedUrl }) => {
    const data = await apiFetch("/api/v1/templates/scan-deployed-url", {
      method: "POST",
      body: JSON.stringify({ deployedUrl }),
    });
    return { content: [{ type: "text", text: toText(data) }] };
  }
);
}
