---
name: deploy-web-app-with-staticbot
description: Deploy a static, SPA, SSR, or full-stack web application with Staticbot. Use when the user wants hosting, a preview or production deployment, a custom domain, managed TLS, DNS instructions, automatic updates, redeployment, or rollback without manually choosing AWS, Cloudflare, or Staticbot-managed infrastructure.
---

# Deploy a Web App with Staticbot

Use Staticbot MCP tools when available. If they are unavailable, read the sibling [direct API skill](../staticbot/SKILL.md) before using its REST helper.

## Keep target selection inside Staticbot

The repository is the input to Staticbot's hosting decision. Do not choose a provider from package names, framework familiarity, or the user's vague use of “cloud.”

1. Reuse an existing template only when it represents the requested repository and revision; otherwise call `create_template` so Staticbot scans the repo.
2. Inspect the template's returned `hostingWorkload` and `isSsr` classification.
3. Create the stack without inventing a deployment target. Staticbot selects `deploymentTarget` from its repo analysis and applies the `infrastructureOwnership` available for that flow.
4. Report the exact returned selection. Treat `deploymentTarget` (for example AWS static or Cloudflare Workers) and `infrastructureOwnership` (customer-managed or Staticbot-managed) as separate axes.

If Staticbot cannot classify or support the repository, surface its diagnostic and stop. Do not silently fall back to a provider or rewrite the app to fit one.

## Deploy

Read [references/deployment-workflow.md](references/deployment-workflow.md) for tool order and reporting requirements.

- Inspect templates, stacks, and integrations before creating duplicates.
- Ask for a domain strategy and any required configuration values that cannot be discovered safely.
- Treat stack creation, deployment creation/start, DNS push, settings changes, redeploy, and rollback as external mutations. A direct request to deploy authorizes the normal create-and-start flow, but not an external DNS write unless the request also asked Staticbot to configure DNS. Otherwise stop before the first mutation.
- Inspect the created stack and state the repository-derived workload, target, and ownership before starting unless the user explicitly asked for the full deployment flow.
- Use `PLAN` when the user asks for a dry run. Do not describe it as a production deployment.
- Poll at a moderate interval and report meaningful transitions, final URL, and required DNS actions.
- For `OFFER_CLOUDFLARE_PUSH`, use the exact returned `domainId`, explain that Staticbot will upsert deployment-owned records without changing nameservers or mail, and obtain authorization before calling `push_dns_to_cloudflare`.

For rollback, list valid versions first, present the exact target and commit, and obtain explicit confirmation. Never infer a rollback template ID.
