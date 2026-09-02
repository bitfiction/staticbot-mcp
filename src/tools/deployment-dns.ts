import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { ToolContext } from "../context.js";

/** Safe DNS actions shared by the local and hosted MCP transports. */
export function registerDeploymentDnsTools(
  server: McpServer,
  { apiFetch, toText }: ToolContext,
): void {
  server.tool(
    "push_dns_to_cloudflare",
    "Push a deployment's certificate-validation and website-routing DNS records into the customer's " +
      "linked Cloudflare zone. This is an external DNS write, although it is idempotent and never changes " +
      "nameservers or mail records. First call get_deployment and select the exact dns item whose " +
      "action is OFFER_CLOUDFLARE_PUSH; pass the deployment response's id as deploymentId and that " +
      "DNS item's domainId as domainId. " +
      "Present the intended action and obtain the user's authorization before calling. Do not infer a " +
      "domain ID, use this for MANUAL_RECORDS_AT_REGISTRAR, or describe it as DNS delegation. Present the " +
      "returned message and every per-record error. Manual records at the current provider remain the fallback.",
    {
      deploymentId: z.string().uuid().describe("Deployment ID returned by get_deployment"),
      domainId: z.string().uuid().describe(
        "Exact domainId from the OFFER_CLOUDFLARE_PUSH item in get_deployment.dns",
      ),
    },
    { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    async ({ deploymentId, domainId }) => {
      const data = await apiFetch(
        `/api/v1/deployments/${deploymentId}/dns/${domainId}/push-cloudflare`,
        { method: "POST" },
      );
      return { content: [{ type: "text", text: toText(data) }] };
    },
  );

  server.tool(
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
      return { content: [{ type: "text", text: toText(data) }] };
    },
  );
}
