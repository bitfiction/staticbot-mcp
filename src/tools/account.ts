import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { ToolContext } from "../context.js";
import { apiToolResult, registerApiTool } from "../server/api-tool.js";

/**
 * Who the caller is, what is connected, and what is actually outstanding.
 *
 * This is the pre-migration, pre-deployment counterpart to `get_migration`'s `pendingAction`. Once a
 * migration exists, agents are told to follow that field and never hard-code phase progression;
 * before one exists there was no equivalent, so the only guidance left was tool-description prose
 * that narrated create_template → create_migration. A conversation that opened with "list my
 * repositories" therefore ended in a confident migration proposal without a single piece of state
 * being read — including whether the Supabase target that migration requires was connected at all.
 */
export function registerAccountTools(
  server: McpServer,
  { apiFetch, toText }: ToolContext,
): void {
  registerApiTool(server,
    "get_account_status",
    "START HERE. The first call of any Staticbot conversation, and the cheapest: it answers in one " +
      "request who the credential belongs to, which integrations are connected, what the plan allows, " +
      "and what is actually outstanding — so you never propose work whose prerequisites are missing. " +
      "Read `pendingAction` and follow it, exactly as you would follow a migration's pendingAction:\n" +
      "  • CONNECT_SOURCE_CONTROL / CONNECT_DATABASE — nothing can start. Give the user the `url` and " +
      "stop; do not propose a migration or a deployment until they have connected it and you have " +
      "called this tool again.\n" +
      "  • CHOOSE_PATH — everything required is connected. Staticbot does two different things and " +
      "the user's goal decides which: `start_hosting` (deploy the repository, keep building where " +
      "they build today, nothing about the app's backend changes) and `start_migration` (move the " +
      "app's database, auth, storage and functions onto infrastructure they own, leaving the " +
      "builder's backend behind). ASK which one they want. Do not infer it from the fact that they " +
      "asked about repositories, and do not default to migration.\n" +
      "Each entry in `nextActions` carries `available`, `blockedBy`, `blockedReason` and the `tool` " +
      "that begins it. A blocked entry is still listed on purpose — it is how you tell 'needs one " +
      "more connection' apart from 'Staticbot cannot do this', and `blockedReason` is written to be " +
      "shown to the user verbatim. Contains no secrets.",
    {},
    { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    async () => {
      const data = await apiFetch("/api/v1/me");
      return apiToolResult(data, toText);
    }
  );
}
