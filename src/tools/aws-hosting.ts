import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { ToolContext } from "../context.js";
import { apiToolResult, registerApiTool } from "../server/api-tool.js";

/**
 * Which AWS account owns an AWS-hosted deployment.
 *
 * The public API owns eligibility and defaulting. This tool only exposes its picker payload so an
 * agent can render the choices and pass one opaque value back to create_deployment unchanged.
 */
export function registerAwsHostingTools(
  server: McpServer,
  { apiFetch, toText }: ToolContext,
): void {
  registerApiTool(server,
    "list_aws_hosting_targets",
    "Use this when an existing stack's deploymentTarget is AWS_STATIC and you need to choose which AWS " +
      "account will own its next deployment. Call it with that stack's stackId before " +
      "create_deployment because managed-account eligibility and the current selection are " +
      "stack-specific.\n\n" +
      "Render the response; do not derive or repair it:\n" +
      "- `managed` is the Staticbot-hosted option. It can be null; when null, do not offer it.\n" +
      "- `customerOptions` contains ready-to-render `label`s and opaque `value`s for connected " +
      "customer accounts.\n" +
      "- `notices` explains why an option is absent or unusable. Surface every notice verbatim.\n" +
      "- `selectedValue` is the stack's current account when stackId was supplied and is suitable " +
      "as the default selection.\n\n" +
      "If one usable option exists, use it without asking. If several exist, present them and let " +
      "the user decide. If none exist, show the notices and do not create a deployment. Pass only a " +
      "returned option's exact `value` as create_deployment.targetAccountId. That value decides " +
      "infrastructure ownership; never invent an account id or send infrastructureOwnership.",
    {
      stackId: z.string().uuid().optional().describe(
        "Optional stack ID. Supply it before create_deployment so `managed`, `notices`, and " +
          "`selectedValue` reflect that stack's AWS hosting rules.",
      ),
    },
    { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    async ({ stackId }) => {
      const qs = stackId ? `?stackId=${encodeURIComponent(stackId)}` : "";
      const data = await apiFetch(`/api/v1/aws/hosting-targets${qs}`);
      return apiToolResult(data, toText);
    },
  );
}
