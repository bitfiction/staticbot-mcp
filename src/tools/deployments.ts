import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { ToolContext } from "../context.js";

/**
 * Registered on every transport. Bodies are unchanged from the original single-file server; the only
 * difference is that apiFetch and toText now arrive per call rather than closing over module state,
 * which is what lets one registry serve both the API-key stdio server and the hosted OAuth one.
 */
export function registerDeploymentTools(server: McpServer, { apiFetch, toText }: ToolContext): void {
// ─── Deployments ─────────────────────────────────────────────────────────────

server.tool(
  "list_deployments",
  "List all deployments. Optionally filter by stackId. Each deployment represents one execution of a stack's infrastructure.",
  {
    stackId: z.string().uuid().optional().describe("Filter deployments by stack ID"),
  },
  { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  async ({ stackId }) => {
    const qs = stackId ? `?stackId=${encodeURIComponent(stackId)}` : "";
    const data = await apiFetch(`/api/v1/deployments${qs}`);
    return { content: [{ type: "text", text: toText(data) }] };
  }
);

server.tool(
  "create_deployment",
  "Create a new deployment for a stack. This prepares the deployment but does NOT start it — call start_deployment next. Default type is APPLY (creates real resources). Use PLAN for a dry-run preview.",
  {
    stackId: z.string().uuid().describe("Stack ID to deploy"),
    deploymentType: z.enum(["APPLY", "PLAN", "DRY_RUN"]).optional().describe(
      "APPLY creates real infrastructure (default). PLAN shows what would change without creating anything. DRY_RUN validates the template."
    ),
  },
  { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  async ({ stackId, deploymentType }) => {
    const body = { stackId, deploymentType: deploymentType ?? "APPLY" };
    const data = await apiFetch("/api/v1/deployments", {
      method: "POST",
      body: JSON.stringify(body),
    });
    return { content: [{ type: "text", text: toText(data) }] };
  }
);

server.tool(
  "start_deployment",
  "Start a deployment that was created with create_deployment. The deployment must be in CREATED status. Once started, Staticbot provisions the repository-derived target stored on the stack. Poll get_deployment to track progress.",
  {
    id: z.string().uuid().describe("Deployment ID"),
  },
  { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  async ({ id }) => {
    const data = await apiFetch(`/api/v1/deployments/${id}/start`, { method: "POST" });
    return { content: [{ type: "text", text: toText(data) }] };
  }
);

server.tool(
  "get_deployment",
  "Get the status of a deployment and the per-domain DNS state. Poll this for progress. " +
  "Statuses: CREATED → PENDING → IN_PROGRESS → WAITING → COMPLETED (or FAILED).\n\n" +
  "**Response fields you should always read:**\n" +
  "- `status` — pipeline state.\n" +
  "- `dns` — per-domain DNS state, populated once Terraform emits a state snapshot. Present " +
  "regardless of `status`; check it on every poll, not just on WAITING.\n" +
  "- `requiredAction` — legacy; only set when `status=WAITING` and there are records to add. Prefer `dns`.\n\n" +
  "**For each entry in `dns`, read `action` and behave as follows:**\n" +
  "- `NO_ACTION` — registrar NS already delegate to a zone Staticbot owns; nothing to ask the user. Celebrate.\n" +
  "- `MANUAL_RECORDS_AT_REGISTRAR` — present `records` (cert CNAME + ALIAS/CNAME for the website) to the user, " +
  "asking them to add them at whatever DNS provider currently serves their domain. **Do NOT** suggest changing " +
  "nameservers — Staticbot intentionally does not recommend NS takeover as a default path.\n" +
  "- `OFFER_CLOUDFLARE_PUSH` — domain is on Cloudflare and an integration is linked. Offer " +
  "push_dns_to_cloudflare using this item's exact `domainId`; obtain authorization before the external DNS write. " +
  "Manual records at the current provider remain the fallback.\n" +
  "- `OFFER_CLOUDFLARE_CONNECT` — domain is on Cloudflare without an integration. Suggest connecting Cloudflare " +
  "(direct the user to the integrations page) for the smoothest no-NS-change path.\n" +
  "- `REGISTER_DOMAIN_FIRST` — domain is not registered. Block and ask the user to register it first.\n\n" +
  "**Other fields per domain:**\n" +
  "- `staticbotManaged` — true when live registrar NS overlap our recorded Route53 zone NS for this apex. Useful " +
  "for explaining 'your domain is already pointing at us'.\n" +
  "- `nsPointedAt` — `AWS_ROUTE53` | `CLOUDFLARE` | `OTHER` (where the live NS resolve to).\n" +
  "- `mailRecordsDetected` — true when MX/TXT/SRV/CAA records exist on the apex. **Treat as a hard block on any " +
  "advice that involves changing nameservers** — doing so would risk breaking the customer's mail.\n" +
  "- `cloudflareLinked` — true when the domain is wired to a Cloudflare integration in Staticbot.\n" +
  "- `domainId` — Staticbot DNS-domain ID; pass this exact value to push_dns_to_cloudflare.\n" +
  "- `records` — flat list of `{type, host, value, description}` to surface to the user.\n\n" +
  "The response also includes `failureSummary` when a worker job is failing or has been retried. Surface its `summary`; when `terminal=true`, include the `statusUrl` so the user can inspect the full failure.",
  {
    id: z.string().uuid().describe("Deployment ID"),
  },
  { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  async ({ id }) => {
    const data = await apiFetch(`/api/v1/deployments/${id}`);
    return { content: [{ type: "text", text: toText(data) }] };
  }
);
}
