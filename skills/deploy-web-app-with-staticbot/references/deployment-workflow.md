# Deployment Workflow

Prefer the Staticbot MCP tools named below. The live API and tool schemas are authoritative if fields change.

## Discovery and planning

1. Call `list_templates`; use `get_template` for a plausible existing template or `create_template` for a new repository.
2. Read repository scan output, especially `hostingWorkload`, `isSsr`, supported configuration, and warnings. Staticbot owns these classifications.
3. Call `list_stacks` before creating a stack for the same template.
4. For Supabase-shaped template variables, use `list_integration_instances` and `list_supabase_projects` when the user wants linked key refresh. Never print or persist credentials.
5. Ask the user to choose `AUTO_GENERATED`, `CUSTOM_DOMAIN`, or an available `EXISTING_DOMAIN` when the choice is not already clear.
6. For a Cloudflare Workers / SSR app, call `list_cloudflare_hosting_targets`. If it reports a customer option AND the user might want the app in their own Cloudflare account, present the choices — Staticbot's managed account is the default. Do not choose for them, and do not ask at all when only the managed choice exists.

## Create and execute

1. Call `create_stack` with the template, safe config overrides, domain option, and optional Supabase picker fields. Do not pass or synthesize a provider choice.
   - Cloudflare alone accepts an account-placement default at stack creation: `cloudflareChoice`, using a `value` from `list_cloudflare_hosting_targets` after `preflight_cloudflare_hosting` returned `ok`. Never pass an account ID, zone ID, or invented value.
   - AWS has no account field on `create_stack`; its concrete account is selected on `create_deployment`.
   - When `preflight_cloudflare_hosting` returns `ok: false`, show the user its `blockingMessage` and do not create anything.
2. Report `hostingWorkload`, `deploymentTarget`, and `infrastructureOwnership` exactly as Staticbot returns them. If an older server omits these fields, report the template classification and say that the final target is stored server-side rather than asserting a provider.
3. If the stack's `deploymentTarget` is `AWS_STATIC`, call `list_aws_hosting_targets` with its exact `stackId` before creating the deployment.
   - Render `managed` only when non-null, render every `customerOptions[].label`, and surface every `notices[]` line verbatim.
   - If one usable option exists, use it without asking. If several exist, let the user choose. If none exist, stop and show the notices.
   - Pass only the selected option's exact `value` as `targetAccountId`. It decides ownership: the managed value means Staticbot-managed infrastructure and a customer account means customer-managed infrastructure. Never invent an account id or send `infrastructureOwnership`.
4. Call `create_deployment` with `APPLY`, `PLAN`, or `DRY_RUN` as requested.
   - Omit `cloudflareChoice` / `cloudflareHostname` unless the user explicitly chose their own Cloudflare account for this deployment; when they did, pass the preflighted choice and the exact hostname.
5. Inspect the created deployment, then call `start_deployment` when authorized.
6. Poll `get_deployment` every 10–20 seconds until terminal or user action is required.

## DNS and completion

Always inspect every `dns` item:

- `NO_ACTION`: no DNS change is needed.
- `MANUAL_RECORDS_AT_REGISTRAR`: present returned records verbatim and keep the current nameservers.
- `OFFER_CLOUDFLARE_PUSH`: offer `push_dns_to_cloudflare` using this item's exact `domainId`; explain the external DNS write and obtain authorization first. Show manual records as fallback.
- `OFFER_CLOUDFLARE_CONNECT`: suggest connecting Cloudflare and show manual records as fallback.
- `REGISTER_DOMAIN_FIRST`: stop until the domain is registered.

Never recommend nameserver delegation as the default. If `mailRecordsDetected` is true, treat nameserver-change advice as blocked.

After a linked-Cloudflare push, present the response's `message` and every per-record error. For a
Cloudflare Workers custom hostname, call `recheck_dns_verification` after records are published. Do
not report the domain live until both returned status fields are `active`; surface
`verificationErrors` otherwise.

Finish with the selected workload/target/ownership, final status, URL, DNS work, and any `failureSummary` or manual follow-up. When the app is hosted in the user's own Cloudflare account, say so plainly: the Worker, its hostname and its certificate live in their account, and Staticbot is not the host.
