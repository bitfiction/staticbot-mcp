import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { ToolContext } from "../context.js";
import { apiToolResult, registerApiTool } from "../server/api-tool.js";

/**
 * Registered on every transport. Bodies are unchanged from the original single-file server; the only
 * difference is that apiFetch and toText now arrive per call rather than closing over module state,
 * which is what lets one registry serve both the API-key stdio server and the hosted OAuth one.
 */
export function registerDeploymentTools(server: McpServer, { apiFetch, toText }: ToolContext): void {
// ─── Deployments ─────────────────────────────────────────────────────────────

registerApiTool(server,
  "list_deployments",
  "List all deployments. Optionally filter by stackId. Each deployment represents one execution of a stack's infrastructure.",
  {
    stackId: z.string().uuid().optional().describe("Filter deployments by stack ID"),
  },
  { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  async ({ stackId }) => {
    const qs = stackId ? `?stackId=${encodeURIComponent(stackId)}` : "";
    const data = await apiFetch(`/api/v1/deployments${qs}`);
    return apiToolResult(data, toText);
  }
);

registerApiTool(server,
  "create_deployment",
  "Create a new deployment for a stack. This prepares the deployment but does NOT start it — call start_deployment next. Default type is APPLY (creates real resources). Use PLAN to preview infrastructure changes without applying them. Readiness-report DRY_RUN mode is not supported by this API.\n\n" +
  "For an AWS-hosted stack, call list_aws_hosting_targets with the stackId first and pass the selected option's exact `value` as targetAccountId. That value DECIDES infrastructure ownership: the managed value means Staticbot-managed hosting and a customer account value means customer-managed hosting. Never invent an account id or send infrastructureOwnership.\n\n" +
  "Do not set cloudflareChoice or cloudflareHostname unless the user has chosen to host a Cloudflare Workers app in their OWN Cloudflare account: call list_cloudflare_hosting_targets, let the user pick, then preflight_cloudflare_hosting, and pass that choice plus the hostname. Omit both to use the stack's existing hosting, which is the normal case — Staticbot hosts it.",
  {
    stackId: z.string().uuid().describe("Stack ID to deploy"),
    deploymentType: z.enum(["APPLY", "PLAN"]).optional().describe(
      "APPLY creates real infrastructure (default). PLAN runs a Terraform plan without applying it."
    ),
    targetAccountId: z.string().optional().describe(
      "AWS-hosted stacks only. The exact `value` selected from list_aws_hosting_targets. This value is the ownership choice: the managed value means Staticbot-managed infrastructure; a customer account value means customer-managed infrastructure. Never invent an account id or pass infrastructureOwnership."
    ),
    cloudflareChoice: z.string().optional().describe(
      "Optional, Cloudflare Workers apps deployed into the user's own account only. The `value` of a choice from list_cloudflare_hosting_targets. Omit to use the stack's existing hosting (Staticbot's account by default) — that is the normal case."
    ),
    cloudflareHostname: z.string().optional().describe(
      "Optional. The hostname the app will serve, e.g. 'example.com' or 'app.example.com'. Required together with a customer cloudflareChoice, and one of the hostnames that account's zones cover. Apex is supported."
    ),
  },
  { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  async ({ stackId, deploymentType, targetAccountId, cloudflareChoice, cloudflareHostname }) => {
    const body: Record<string, unknown> = { stackId, deploymentType: deploymentType ?? "APPLY" };
    // An AWS account value is an ownership decision, not a hint. Forward it only when the caller
    // selected one; the API scopes and validates the value before persisting the deployment.
    if (targetAccountId) {
      body.targetAccountId = targetAccountId;
    }
    // Forward only a choice the user actually made. The server re-validates it (ownership, zone,
    // capability, collisions) inside the create transaction, so a stale choice is rejected rather
    // than deployed somewhere unexpected.
    if (cloudflareChoice) {
      body.cloudflareChoice = cloudflareChoice;
    }
    if (cloudflareHostname) {
      body.cloudflareHostname = cloudflareHostname;
    }
    const data = await apiFetch("/api/v1/deployments", {
      method: "POST",
      body: JSON.stringify(body),
    });
    return apiToolResult(data, toText);
  }
);

registerApiTool(server,
  "start_deployment",
  "Start a deployment that was created with create_deployment. The deployment must be in CREATED status. APPLY provisions the repository-derived target stored on the stack; PLAN runs only the infrastructure plan. Poll get_deployment to track progress.",
  {
    id: z.string().uuid().describe("Deployment ID"),
  },
  { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  async ({ id }) => {
    const data = await apiFetch(`/api/v1/deployments/${id}/start`, { method: "POST" });
    return apiToolResult(data, toText);
  }
);

registerApiTool(server,
  "get_deployment",
  "Get the status of a deployment and the per-domain DNS state. Poll this for progress. " +
  "Statuses: CREATED → PENDING → IN_PROGRESS → WAITING → COMPLETED (or FAILED).\n\n" +
  "**Response fields you should always read:**\n" +
  "- `status` — pipeline state.\n" +
  "- `dns` — per-domain DNS state, populated once Terraform emits a state snapshot. Present " +
  "regardless of `status`; check it on every poll, not just on WAITING. Always empty for a Cloudflare Workers " +
  "deployment: call get_worker_app_dns for its custom-hostname records instead.\n" +
  "- `failureSummary` — see below; a DNS wait arrives here, not as a status.\n" +
  "- `requiredAction` — legacy; only set when `status=WAITING` and there are records to add. Prefer `dns`.\n\n" +
  "**For each entry in `dns`, read `action` and behave as follows:**\n" +
  "- `NO_ACTION` — DNS already points at a zone Staticbot runs; nothing to ask the user. Celebrate.\n" +
  "- `MANUAL_RECORDS_AT_REGISTRAR` — present `records` (certificate CNAME + ALIAS/CNAME for the website) and ask the " +
  "user to add them at the DNS provider that serves their domain. Tell them to type each record's `hostField` into " +
  "the provider's host field (an empty `hostField` means the root, usually `@`), never the full `host`: most " +
  "forms append the domain, so the full name ends up doubled. Use `dnsProvider` for the provider's own words " +
  "(`addRecordPath`, `hostFieldLabel`, `valueFieldLabel`, `beforeYouStart`) and link `dnsProvider.guideUrl`. A record " +
  "with `supportedAtProvider=false` can't be added there: relay its `providerNote` instead.\n" +
  "- `OFFER_CLOUDFLARE_PUSH` — domain is on Cloudflare and an integration is linked. Offer " +
  "push_dns_to_cloudflare using this item's exact `domainId`; obtain authorization before the external DNS write. " +
  "Manual records at the current provider remain the fallback.\n" +
  "- `OFFER_CLOUDFLARE_CONNECT` — domain is on Cloudflare without an integration. Suggest connecting Cloudflare " +
  "(direct the user to the integrations page) for the smoothest no-NS-change path.\n" +
  "- `REGISTER_DOMAIN_FIRST` — domain is not registered. Block and ask the user to register it first.\n" +
  "- `RESERVED_DOMAIN` — domain is a reserved name nobody can register (e.g. a.com, example.com, *.test). It can never work: stop and ask the user for a domain they own.\n\n" +
  "**Nameservers:** mention a nameserver change ONLY when the entry has `nameserverOption`; otherwise adding " +
  "`records` is the path. Lead with it only when `nameserverOption.recommended` is true (for example, a DNS host " +
  "that can't point the root domain at the site); otherwise offer it as the alternative. Always relay its " +
  "`caveat` before the user switches. For `DELEGATE_APEX_NS`, the user replaces the domain's nameservers at the " +
  "registrar (`registrar`, `registrarGuideUrl`) with `nameserverOption.nameservers`; for `DELEGATE_SUBDOMAIN_NS`, " +
  "they add NS records for that subdomain with those values. For `MIRROR_THEN_DELEGATE` (`mailRecordsDetected=true`), " +
  "`nameservers` is empty on purpose: the existing email records must be copied first, which only the dashboard " +
  "does (`statusUrl`), and a nameserver change before that breaks the user's email.\n\n" +
  "**Other fields per domain:**\n" +
  "- `staticbotManaged` — true when the live nameservers overlap a DNS zone Staticbot runs for this domain (AWS " +
  "Route 53 or Staticbot's Cloudflare). Useful for explaining 'your domain is already pointing at us'.\n" +
  "- `nsPointedAt` — `AWS_ROUTE53` | `CLOUDFLARE` | `OTHER` | `NONE` (where the live nameservers resolve; `NONE` = " +
  "the domain has no nameservers).\n" +
  "- `mailRecordsDetected` — true when MX/TXT/SRV/CAA records exist. Never advise a plain nameserver change when true.\n" +
  "- `cloudflareLinked` — true when the domain is wired to a Cloudflare integration in Staticbot.\n" +
  "- `domainId` — Staticbot DNS-domain ID; pass this exact value to push_dns_to_cloudflare.\n" +
  "- `records` — `{type, host, value, description, hostField, typeAtProvider, supportedAtProvider, providerNote, checkKey}`. " +
  "After the user adds them, call check_dns_records to confirm (`checkKey` joins each record to its verdict).\n\n" +
  "**`failureSummary`** is present when a worker job is failing or has been retried. When " +
  "`failureSummary.customerDnsWait` is set (`failureReason=CUSTOMER_DNS_VALIDATION_TIMEOUT`), the deployment is " +
  "waiting for the user's certificate record, not broken: do not report a failure. Follow " +
  "`customerDnsWait.instructions`: get the records added (or pushed when `cloudflarePush`), confirm with " +
  "check_dns_records until `certificateRecordsFound` is true, then send the user to `statusUrl` to continue the " +
  "deployment. Otherwise surface `summary`; when `terminal=true`, include the `statusUrl` so the user can inspect the full failure.",
  {
    id: z.string().uuid().describe("Deployment ID"),
  },
  { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  async ({ id }) => {
    const data = await apiFetch(`/api/v1/deployments/${id}`);
    return apiToolResult(data, toText);
  }
);
}
