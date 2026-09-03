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
  { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  async () => {
    const data = await apiFetch("/api/v1/templates");
    return { content: [{ type: "text", text: toText(data) }] };
  }
);

server.tool(
  "get_template",
  "Get details of a template including its configuration variables. Each entry has `key`, `configured` (whether a value is set at all), and `value`. `value` is the real value for location-shaped keys (URLs, regions, names, branches) and \"[REDACTED]\" for credential-shaped keys — Staticbot never returns secrets, so read `configured` to tell \"withheld\" apart from \"not set\". Use this to see which configOverrides are available when creating a stack.",
  {
    id: z.string().uuid().describe("Template ID"),
  },
  { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
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
  { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
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

}
