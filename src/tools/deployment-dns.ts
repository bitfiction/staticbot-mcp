import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { ToolContext } from "../context.js";
import { apiToolResult, registerApiTool } from "../server/api-tool.js";

/** Safe DNS actions shared by the local and hosted MCP transports. */
export function registerDeploymentDnsTools(
  server: McpServer,
  { apiFetch, toText }: ToolContext,
): void {
  registerApiTool(server,
    "push_dns_to_cloudflare",
    "Push a deployment's certificate-validation and website-routing DNS records into the customer's " +
      "linked Cloudflare zone. This is an external DNS write, although it is idempotent and never changes " +
      "nameservers or mail records. First call get_deployment and select the exact dns item whose " +
      "action is OFFER_CLOUDFLARE_PUSH; pass the deployment response's id as deploymentId and that " +
      "DNS item's domainId as domainId. For a Cloudflare Workers deployment (its get_deployment dns list is " +
      "empty), call get_worker_app_dns and use its domainId only when canPush is true. " +
      "Present the intended action and obtain the user's authorization before calling. Do not infer a " +
      "domain ID, use this for MANUAL_RECORDS_AT_REGISTRAR, or describe it as DNS delegation. Present the " +
      "returned message and every per-record error. Manual records at the current provider remain the fallback.",
    {
      deploymentId: z.string().uuid().describe("Deployment ID returned by get_deployment"),
      domainId: z.string().uuid().describe(
        "Exact domainId from the OFFER_CLOUDFLARE_PUSH item in get_deployment.dns, or from get_worker_app_dns when canPush is true",
      ),
    },
    { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    async ({ deploymentId, domainId }) => {
      const data = await apiFetch(
        `/api/v1/deployments/${deploymentId}/dns/${domainId}/push-cloudflare`,
        { method: "POST" },
      );
      return apiToolResult(data, toText);
    },
  );

  registerApiTool(server,
    "check_dns_records",
    "Check whether the DNS records a deployment asked the user to add are live by querying each domain’s public " +
      "authoritative nameservers. Returns an informational verdict for each record. Call it after the " +
      "user says they added the records from get_deployment, and when a deployment is waiting for its " +
      "certificate record (failureSummary.customerDnsWait). Poll no faster than every 30 seconds. Join each " +
      "verdict to get_deployment's dns[].records[] by checkKey. Relay each record's message as written. " +
      "MISSING: not there yet. WRONG_VALUE or DOUBLED_NAME (the domain was typed into the host field): tell the " +
      "user exactly what to change. CONFLICT: another record on that name must go first. UNVERIFIED: website " +
      "addresses answer but an alias or proxy hides the target; this is not a problem to fix. UNKNOWN: the " +
      "lookup failed; never tell the user the record is missing. certificateRecordsFound=true means every " +
      "certificate record answers correctly; the certificate itself may still take a few minutes.",
    {
      deploymentId: z.string().uuid().describe("Deployment ID returned by get_deployment"),
    },
    { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    async ({ deploymentId }) => {
      const data = await apiFetch(`/api/v1/deployments/${deploymentId}/dns/record-check`);
      return apiToolResult(data, toText);
    },
  );

  registerApiTool(server,
    "get_worker_app_dns",
    "Get the custom-hostname DNS card of a Cloudflare Workers deployment (its get_deployment dns list is always " +
      "empty): the records the user adds at their DNS provider and the live certificate and routing status from " +
      "Cloudflare. Records: a CNAME from customerHostname to routingTarget (DNS only, not proxied), each of " +
      "dcvRecords, and ownershipVerification when present; give the user each record's hostField. Use dnsProvider " +
      "for the provider's name and guide link. When canPush is true, offer push_dns_to_cloudflare with domainId " +
      "instead. Read-only; it reads Cloudflare live, so poll no faster than every 30 seconds. A null result means " +
      "the deployment has no Cloudflare custom hostname. Do not report the domain live unless both " +
      "customHostnameStatus and hostnameStatus are active; surface verificationErrors. Use recheck_dns_verification " +
      "to ask Cloudflare to retry after the records are added.",
    {
      deploymentId: z.string().uuid().describe("Cloudflare Workers deployment ID"),
    },
    { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    async ({ deploymentId }) => {
      const data = await apiFetch(`/api/v1/deployments/${deploymentId}/worker-app-dns`);
      return apiToolResult(data, toText);
    },
  );

  registerApiTool(server,
    "recheck_dns_verification",
    "Ask Cloudflare to retry custom-hostname domain-control validation for a Cloudflare Workers " +
      "deployment, then return refreshed certificate and hostname-routing status. Call this after DNS " +
      "records were published or when the user explicitly asks to recheck verification. This action does " +
      "not write DNS records or change nameservers. A null result means the deployment has no applicable " +
      "Cloudflare custom hostname. Surface verificationErrors and do not report the domain live unless both " +
      "customHostnameStatus and hostnameStatus are active.",
    {
      deploymentId: z.string().uuid().describe("Cloudflare Workers deployment ID"),
    },
    { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    async ({ deploymentId }) => {
      const data = await apiFetch(
        `/api/v1/deployments/${deploymentId}/worker-app-dns/recheck`,
        { method: "POST" },
      );
      return apiToolResult(data, toText);
    },
  );
}
