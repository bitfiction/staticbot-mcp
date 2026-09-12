---
name: migrate-vibe-coded-app
description: Migrate applications from Base44, Lovable, Bolt, or Firebase to customer-owned Supabase infrastructure using Staticbot. Use when the user wants to leave an app builder, remove vendor lock-in, move database/auth/storage/functions, create a migration preview, switch the backend, or continue development outside the original platform.
---

# Migrate a Vibe-Coded App

Use Staticbot MCP tools when available. If they are unavailable, read the sibling [direct API skill](../staticbot/SKILL.md) before using its REST helper.

Read [references/migration-workflow.md](references/migration-workflow.md) for source-specific preparation and action routing.

## Confirm this is the path the user wants

Call `get_account_status` first. It reports what is connected and a `pendingAction`:

- `CONNECT_SOURCE_CONTROL` / `CONNECT_DATABASE` — a migration cannot be created. Give the user the `url` and stop; do not walk them through migration planning they cannot act on.
- `CHOOSE_PATH` — confirm the user wants to move off their builder's backend, not simply to host the repository. Hosting (`start_hosting`, the deploy skill) changes nothing about the app's backend and is the right answer for "put this online". Migration is for leaving the builder's backend behind. Asking costs one sentence; guessing costs a wrong multi-phase pipeline.

A request to list repositories, templates, or integrations is not a request to migrate.

## Preserve human control

- Start with non-mutating discovery of integrations, repository/template metadata, source configuration, and target projects.
- Never ask the user to paste credentials into chat or write secrets into the repository. Use connected integrations and secret-bearing tool fields only when the user authorizes the migration.
- After `create_migration`, stop when discovery reaches `PAUSED_FOR_APPROVAL`. Fetch the migration and jobs, summarize tables, data, auth, storage, functions, warnings, and unsupported items, then obtain explicit approval before `confirm_migration`.
- Follow `pendingAction` from `get_migration`; do not hard-code phase progression or choose a default at a choice gate.
- When `targetConflictReport.clashesFound` is true, call `get_clean_target_plan` and present its live rows and `confirmationProjectRef` — the conflict report on the migration is a discovery-time snapshot, and the target may have changed since. If it reports `available: false`, give the user `unavailableReason` rather than attempting the call. Cleaning is irreversible: obtain explicit confirmation for the exact scope and `confirmationProjectRef` before `clean_migration_target`. If the user declines cleanup, record that decision in the conversation and continue only through the action they explicitly select.
- When `preFlightGate` is present, present its enabled actions and consequences verbatim. Pass only the user's selected action ID as `gateChoice`; never default to the recommendation. If target conflicts and a strategy gate coexist, resolve the cleanup decision first, wait for any cleanup to complete, then present the strategy gate.
- Present preview and backend-switchover choices with their consequences. Nothing about a preview authorizes production switchover.
- When the user chooses frontend deployment with Staticbot, let Staticbot analyze the repository and select the supported AWS or Cloudflare target plus its ownership model. Do not promise S3/CloudFront merely because the migration skill historically used AWS.
- Read `failureBanner.retryable` before retrying. Explain the impact and get confirmation before skipping work.

Poll long-running work at a moderate interval. Stop at terminal status or a user-action gate. On completion, report preview/live URLs, skipped jobs, partial failures, package availability, and manual follow-up.
