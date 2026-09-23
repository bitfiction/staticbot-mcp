---
name: live-migrate-ai-built-app
description: Move a live Lovable or Base44 app that already has users to customer-owned Supabase and Staticbot hosting with a planned maintenance window - test migration, cutover plan, maintenance page, source write freeze, fresh final copy, verification, domain switch, and aftercare. Use when the app has real users, data, or daily use and the user wants to switch production, plan a cutover, go live on the migrated stack, or move their domain off the builder. For a first migration or a preview only, use migrate-vibe-coded-app instead.
---

# Live-Migrate an AI-Built App

This skill orchestrates a **planned-downtime** cutover of a production app. The Staticbot migration itself is delegated to the sibling [migrate-vibe-coded-app](../migrate-vibe-coded-app/SKILL.md) skill and its `pendingAction` routing; deployment and DNS mechanics come from [deploy-web-app-with-staticbot](../deploy-web-app-with-staticbot/SKILL.md). Use Staticbot MCP tools when available, otherwise the [direct API skill](../staticbot/SKILL.md).

Then load the builder sub-skill: [live-migrate-lovable-app](../live-migrate-lovable-app/SKILL.md) or [live-migrate-base44-app](../live-migrate-base44-app/SKILL.md). It owns the source write freeze, which differs completely between builders.

## What Staticbot does and what the operator does

Staticbot tools cover: discovery, migration, target cleanup, preview + evidence, frontend deployment, DNS records (and pushing them to a linked Cloudflare zone), and Continuous Sync. Nothing in Staticbot can freeze writes in Lovable or Base44, send user notices, or edit DNS at a third-party registrar. For those steps the agent prepares exact instructions, scripts, and checks; the user performs them and confirms. Say this plainly at the start. Never report a manual step as done without the user's confirmation or a check you ran yourself.

## Hard rules

- **Phase gates are the user's.** Every phase below ends in an explicit go/no-go from the user. Never chain phases on your own, even if the previous one looked green.
- **The rehearsal changes nothing in production.** No DNS change, no builder secret change, no merge into the branch the builder publishes, and never `switch-fully-to-supabase` at the backend-switchover gate during rehearsal (present the options; recommend `source-primary-supabase-backup` or `handle-myself`).
- **No final copy without a proven freeze.** A maintenance page is not a write freeze. Do not start the final migration until every writer in the state file has a failed-write probe recorded.
- **Recovery changes after the first production write to the target.** Before it: restore the old routing, lift the source freeze. After it: stay in maintenance, preserve target data, fix forward; DNS rollback alone loses customer work.
- Keep all existing Staticbot rules: no credentials in chat, exact IDs from tool responses, explicit confirmation for `clean_migration_target`, DNS pushes, and switchover choices.

## State file

Keep one file, `staticbot-live-migration.md`, in the working directory (do not commit it to the builder's repository). Start it from [assets/cutover-state.md](assets/cutover-state.md). Record every ID, timestamp, decision, probe result, and saved DNS record there as you go. On resume, read it first and continue from the last completed phase. It contains no secrets; never write keys into it.

## Phases

Read [references/cutover-runbook.md](references/cutover-runbook.md) for each phase's steps and exit criteria before executing that phase.

0. **Test migration.** Migrate into a separate target up to a working preview. Present `get_migration` preview evidence (`worked` / `problems` / `unverified`). The user tests critical journeys. Record timings.
1. **Cutover plan.** Classify the hosting target and DNS provider ([references/domain-switch.md](references/domain-switch.md)), pick the final-copy strategy and with it the maintenance approach, prepare the freeze (builder sub-skill), fix the window, name the abort deadline.
2. **Pre-stage.** Create the production stack on the domain, publish certificate-validation records ahead of time, rehearse the maintenance/app version swap on that stack before any traffic reaches it, rehearse the freeze, send the advance notice ([references/communications.md](references/communications.md)).
3. **Window start.** Maintenance on (A: routing record moves to the production stack, already serving the maintenance version; B: publish the builder's maintenance version), drain in-flight work, apply and prove the source freeze.
4. **Final copy.** Fresh source export after the freeze, migrate into the clean final target, undo any freeze artifacts that travelled with the export.
5. **Verify.** Preview evidence plus data counts, sign-in, permissions, critical journeys, integrations. User signs go/no-go.
6. **Switch and reopen.** A: swap the production stack back to the tested app version; B: move the routing record to the production stack. Verify on the real domain, user approves reopening, resume jobs on the target only, send the completion notice.
7. **Aftercare.** Observation period, source kept frozen for the recovery period, backups, Continuous Sync or repository workflow, cleanup of temporary helpers.

## Maintenance approach

A Staticbot stack locks its domain once its deployment exists, and a hostname cannot be served by two stacks. So maintenance and the app share **one production stack** and alternate as website versions of it. Read [references/maintenance-versions.md](references/maintenance-versions.md).

- **A (default): maintenance as a version of the production stack.** Before the window, create the production stack on the customer's domain with the tested app build. Push a maintenance commit to the branch it builds from, deploy it, and swap back to the app version with `rollback_website` at reopening. The domain moves from the builder to Staticbot once, at window start. Reopening needs no DNS change. Requires the clean-and-reuse final-copy strategy, so the app build's Supabase keys stay valid.
- **B: maintenance published from the builder.** Instant on the custom domain and the builder's default URL. The only DNS change is at reopening, to the production stack. Use B when the final copy goes to a fresh target, when phase 2 cannot prove the version swap, or when the user prefers not to touch DNS before the move is verified.

## Out of scope

Zero-downtime moves (blue-green with CDC) are a custom Staticbot enterprise engagement: point the user to `https://www.staticbot.dev/pricing#enterprise-migration` instead of improvising replication. Bolt and Firebase sources have no live-cutover sub-skill yet; use the generic runbook and say that the freeze procedure must be worked out with the user.
