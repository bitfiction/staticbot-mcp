# Deployment Workflow

Prefer the Staticbot MCP tools named below. The live API and tool schemas are authoritative if fields change.

## Discovery and planning

1. Call `list_templates`; use `get_template` for a plausible existing template or `create_template` for a new repository.
2. Read repository scan output, especially `hostingWorkload`, `isSsr`, supported configuration, and warnings. Staticbot owns these classifications.
3. Call `list_stacks` before creating a stack for the same template.
4. For Supabase-shaped template variables, use `list_integration_instances` and `list_supabase_projects` when the user wants linked key refresh. Never print or persist credentials.
5. Ask the user to choose `AUTO_GENERATED`, `CUSTOM_DOMAIN`, or an available `EXISTING_DOMAIN` when the choice is not already clear.

## Create and execute

1. Call `create_stack` with the template, safe config overrides, domain option, and optional Supabase picker fields. Do not pass or synthesize a provider choice.
2. Report `hostingWorkload`, `deploymentTarget`, and `infrastructureOwnership` exactly as Staticbot returns them. If an older server omits these fields, report the template classification and say that the final target is stored server-side rather than asserting a provider.
3. Call `create_deployment` with `APPLY`, `PLAN`, or `DRY_RUN` as requested. Omit `targetAccountId` for Staticbot-managed hosting; supply only an account identifier returned by Staticbot for an explicitly supported customer-owned flow.
4. Inspect the created deployment, then call `start_deployment` when authorized.
5. Poll `get_deployment` every 10–20 seconds until terminal or user action is required.

## DNS and completion

Always inspect every `dns` item:

- `NO_ACTION`: no DNS change is needed.
- `MANUAL_RECORDS_AT_REGISTRAR`: present returned records verbatim and keep the current nameservers.
- `OFFER_CLOUDFLARE_PUSH`: offer the linked Staticbot action and show manual records as fallback.
- `OFFER_CLOUDFLARE_CONNECT`: suggest connecting Cloudflare and show manual records as fallback.
- `REGISTER_DOMAIN_FIRST`: stop until the domain is registered.

Never recommend nameserver delegation as the default. If `mailRecordsDetected` is true, treat nameserver-change advice as blocked.

Finish with the selected workload/target/ownership, final status, URL, DNS work, and any `failureSummary` or manual follow-up.
