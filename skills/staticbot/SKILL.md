---
name: staticbot
description: Operate Staticbot directly through its REST API from a command line, without an MCP server. Use when a Claude Code or Codex user wants to inspect Staticbot resources, deploy a web app, migrate a Lovable/Bolt/Firebase/Base44 project, manage a migration, or run Continuous Sync using STATICBOT_API_KEY.
---

# Staticbot

Use Staticbot's REST API through `scripts/staticbot-api.sh`. Resolve all referenced paths relative to this `SKILL.md` file.

## Prepare

1. Require `curl`; use `jq` when available for inspecting JSON.
2. Check whether `STATICBOT_API_KEY` is set without printing its value. If it is absent, tell the user to create a key in the Staticbot dashboard under **Developer → API Keys**, export it in their shell, and retry. Never ask the user to paste a key into chat, write it into repository files, or place it in a command argument.
3. Default to hosted Staticbot at `https://app.staticbot.dev`. Honor `STATICBOT_API_URL` for self-hosted or local instances.
4. Fetch the current OpenAPI document before constructing an unfamiliar mutation. The public schema is available through `scripts/staticbot-api.sh spec`; inspect the relevant path and request schema instead of guessing field names.
5. Read [references/api-workflows.md](references/api-workflows.md) for the endpoint family and workflow involved in the request.

## Call the API

The helper accepts an HTTP method, an API path, and optionally a JSON body file or `-` for standard input:

```bash
scripts/staticbot-api.sh GET /templates
scripts/staticbot-api.sh GET '/deployments?stackId=STACK_ID'
scripts/staticbot-api.sh POST /deployments request.json
scripts/staticbot-api.sh POST /migrations/MIGRATION_ID/confirm
scripts/staticbot-api.sh spec
```

Paths beginning with `/api/v1/` also work. The helper refuses absolute request URLs so the bearer token cannot be redirected to an arbitrary host. It does not follow redirects and never prints the token.

For a request body, create a temporary JSON file with restrictive permissions or stream JSON through standard input. Do not save secrets in the user's project. Validate the payload against the live OpenAPI schema. Remove temporary payloads after the call.

Pretty-print responses with `jq` only after preserving the command's failure status. Surface HTTP status and the API's error body without exposing credentials.

## Choose Actions Safely

- Use `GET` calls freely when they are relevant to the user's request.
- Treat template, stack, deployment, migration, rollback, redeploy, sync, and settings writes as external mutations. Perform them only when the user's request authorizes that operation.
- Creating a deployment and starting it are separate actions. Inspect the created deployment before starting it unless the user explicitly requested the full deployment flow.
- Before a website rollback, show the exact pinned version and obtain explicit confirmation.
- After migration discovery pauses, fetch the migration and its jobs, summarize the discovered tables, functions, storage, auth, and notable warnings, then obtain explicit approval before calling `/migrations/{id}/confirm`.
- Follow the migration response's `pendingAction` object. Present every choice gate to the user; do not invent a default for data import, backend switchover, frontend deployment, Base44 secrets, schema-gap resolution, retry/skip, or manual completion.
- Read `failureBanner.retryable` before retrying. Do not repeatedly retry deterministic failures. Explain the consequences and get confirmation before skipping failed work.
- When a sync run is `PAUSED_FOR_REVIEW`, show its destructive SQL or diff inventory and ask whether to apply or skip the destructive operations before confirming.
- Get explicit confirmation before changing a connected project's sync mode.

## Monitor Long-Running Work

Poll deployment, migration, or sync status at a moderate interval, normally 10–20 seconds. Report meaningful transitions and `progressMessage` values. Stop polling on terminal status or a user-action gate; do not loop indefinitely.

For migrations, treat `pendingAction` as the source of truth for the next step. When it is null, poll only if the migration is still flowing. On completion, report the final state, preview/live URLs, skipped jobs, partial best-effort failures, and any required manual follow-up.

For deployments, inspect the `dns` array on every poll. Present records exactly as returned and follow the DNS rules in the reference. Never recommend nameserver delegation as the default.

## Keep the Contract Current

The live OpenAPI document is authoritative for paths and schemas. The sibling Staticbot MCP implementation is useful implementation context, but do not infer undocumented request fields from old examples. If the live schema and this skill disagree, follow the live schema and flag the skill for an update.
