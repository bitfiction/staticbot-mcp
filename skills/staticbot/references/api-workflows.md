# Staticbot API Workflows

Use this as a workflow map. Fetch the live OpenAPI schema with `scripts/staticbot-api.sh spec` for exact request and response fields.

## Endpoint Families

All authenticated endpoints are under `/api/v1`; the helper adds that prefix to short paths.

### Templates

- `GET /templates`
- `GET /templates/{id}`
- `POST /templates`
- `POST /templates/scan-deployed-url`

Templates describe a repository and its supported configuration. List before creating; inspect a chosen template before using its configuration overrides.

### Stacks

- `GET /stacks`
- `GET /stacks/{id}`
- `POST /stacks`

A stack combines one or more templates with domain and infrastructure configuration. Inspect templates and existing stacks before creating another stack.

### Deployments

- `GET /deployments` with optional `stackId`
- `GET /deployments/{id}`
- `POST /deployments`
- `POST /deployments/{id}/start`
- `GET|PATCH /deployments/{id}/auto-deploy-settings`
- `GET /deployments/{id}/auto-deploy-info`
- `GET /deployments/{id}/rollback-versions`
- `POST /deployments/{id}/rollback-website?templateId=...`
- `POST /deployments/{id}/redeploy-website?useLatest=true|false`
- `POST /deployments/{id}/dns/{domainId}/push-cloudflare`
- `POST /deployments/{id}/worker-app-dns/recheck`

Typical deployment flow: inspect or create a template, create a stack, create a deployment, inspect it, start it, and poll `GET /deployments/{id}`. Share its `statusUrl`. Read `dns` on every response, not only while the deployment is waiting.

DNS actions:

- `NO_ACTION`: DNS is already delegated correctly; do not ask for changes.
- `MANUAL_RECORDS_AT_REGISTRAR`: show `records` verbatim and tell the user to add them at the current DNS provider. Do not suggest nameserver changes.
- `OFFER_CLOUDFLARE_PUSH`: offer the linked-zone push using this item's exact `domainId`; explain the external DNS write and obtain authorization first. Show manual records as fallback.
- `OFFER_CLOUDFLARE_CONNECT`: suggest connecting Cloudflare; show manual records as fallback.
- `REGISTER_DOMAIN_FIRST`: stop and ask the user to register the domain.

If `mailRecordsDetected` is true, treat that as a hard block on nameserver-change advice.

The Cloudflare push idempotently writes only deployment-owned certificate-validation and website
routing records. It does not delegate nameservers or modify mail records. Present its structured
record outcomes. The recheck endpoint retriggers custom-hostname validation without writing DNS; do
not report a Workers custom hostname live until both returned status fields are `active`.

### Migrations

- `GET|POST /migrations`
- `GET /migrations/{id}`
- `POST /migrations/{id}/confirm|resume|pause`
- `POST /migrations/{id}/clean-target`
- `GET /migrations/{id}/jobs`
- `POST /migrations/jobs/{jobId}/retry|skip|complete`
- `GET /migrations/{id}/deployments`
- `GET /migrations/{id}/download-package`
- `POST /migrations/{migrationId}/preview?mode=light|full`
- `POST /migrations/{migrationId}/jobs/{jobId}/choose-method`
- `POST /migrations/{migrationId}/jobs/{jobId}/choose-backend-switchover`
- `POST /migrations/{migrationId}/jobs/{jobId}/choose-frontend-deploy`
- `POST /migrations/{migrationId}/jobs/{jobId}/provide-base44-secrets`
- `POST /migrations/{migrationId}/jobs/{jobId}/resolve-schema-gap`
- `POST /migrations/jobs/{jobId}/validate-function`
- `GET /migrations/integrations/instances`
- `GET /migrations/parse-source-keys?githubRepoUrl=...`
- `GET /migrations/integrations/instances/{id}/supabase-projects`

Supported source types include `LOVABLE_SUPABASE`, `BOLT_SUPABASE`, `FIREBASE`, `BASE44_SUPABASE`, and `BASE44_NATIVE`. Never assume their request fields are identical; consult the live schema.

Typical migration flow:

1. Inspect integration instances, source credentials or integration, target, and template.
2. Create the migration with fields validated against the live schema.
3. Poll until discovery reaches `PAUSED_FOR_APPROVAL`.
4. Fetch jobs and present the discovery inventory to the user.
5. If `targetConflictReport.clashesFound` is true, present the conflicts and cleanup consequences. Cleanup requires a separate explicit confirmation for the exact scope and `confirmationProjectRef`; migration approval does not authorize deletion.
6. If `preFlightGate` is present, present its enabled actions and consequences and submit the user's exact action ID as `gateChoice` to the confirm endpoint.
7. Otherwise, confirm only after explicit approval.
8. Poll and follow `pendingAction`. Present choices rather than selecting defaults.
9. On failure, inspect `failureBanner`, job details, and `retryable`; ask before retrying or skipping when consequences are material. A failed target cleanup is retry-only.
10. Finish with status, preview/live URLs, partial failures, skipped jobs, and manual follow-ups.

`pendingAction.type` can include `REVIEW_TARGET_CONFLICTS`, `WAIT_FOR_TARGET_CLEANUP`, `RETRY_TARGET_CLEANUP`, `CHOOSE_MIGRATION_STRATEGY`, `CONFIRM`, `RETRY_OR_SKIP`, `PROVIDE_BASE44_SECRETS`, `RESOLVE_SCHEMA_GAP`, `CHOOSE_BACKEND_SWITCHOVER`, `CHOOSE_DATA_IMPORT_METHOD`, `CHOOSE_FRONTEND_DEPLOY`, and `COMPLETE_MANUAL_JOB`. Use its returned IDs and endpoint rather than reconstructing them from phase assumptions.

### Connected Projects and Continuous Sync

- `GET /connected-projects` with optional `syncMode`
- `GET /connected-projects/{id}`
- `POST /connected-projects/{id}/sync`
- `GET /connected-projects/{id}/sync-runs`
- `GET /connected-projects/{id}/sync-runs/{runId}`
- `GET /connected-projects/{id}/sync-runs/{runId}/jobs`
- `POST /connected-projects/{id}/sync-runs/{runId}/confirm`
- `POST /connected-projects/{id}/sync-runs/{runId}/retry`
- `POST /connected-projects/{id}/sync-runs/{runId}/skip`
- `PATCH /connected-projects/{id}/sync-mode`

Typical sync flow: inspect the project, trigger sync if authorized, identify the new run, and poll it. If it pauses for destructive review, show the `diffInventory`, SQL, summaries, and affected jobs. Ask the user whether to apply or skip destructive operations before confirming. Inspect all jobs before reporting completion.

## Inspect the Live Schema

Save the public schema outside the project and query the exact operation:

```bash
scripts/staticbot-api.sh spec > /tmp/staticbot-openapi.json
jq '.paths["/api/v1/migrations"].post' /tmp/staticbot-openapi.json
jq '.paths["/api/v1/deployments/{id}"].get' /tmp/staticbot-openapi.json
```

Follow `$ref` values into `.components.schemas`. Do this especially for create, choice, confirmation, rollback, sync-mode, and secret-bearing requests.

## Authentication and Data Handling

- Send `Authorization: Bearer $STATICBOT_API_KEY` only to the configured Staticbot origin.
- Do not use shell tracing, verbose curl, redirects, or commands that print the environment.
- Keep source credentials, service-account JSON, API keys, and generated package passwords out of chat, logs, repository files, and command arguments.
- Treat presigned download URLs and package passwords as secrets. Do not fetch or expose a migration package unless the user requested it.
- Use temporary files with restrictive permissions for sensitive request bodies, and delete them after use.
