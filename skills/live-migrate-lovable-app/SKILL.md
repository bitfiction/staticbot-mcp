---
name: live-migrate-lovable-app
description: Lovable-specific steps for a live cutover with live-migrate-ai-built-app - source write freeze for Lovable Cloud or a Lovable app on its own Supabase, fresh Cloud Data export, repairing freeze grants on the target, sign-in continuity, and Lovable maintenance options. Use together with live-migrate-ai-built-app when the live app was built with Lovable.
---

# Live-Migrate a Lovable App

Load [live-migrate-ai-built-app](../live-migrate-ai-built-app/SKILL.md) first; it owns the phases, gates, and domain switch. This skill fills in the Lovable parts.

## Identify the source shape

- **Lovable Cloud** (`LOVABLE_SUPABASE`, backend managed by Lovable): the user has no direct database credentials. SQL reaches the database through Lovable, either through the Lovable agent (which commits a migration file to the repository) or a SQL runner if the project offers one.
- **Lovable app on the user's own Supabase project:** the user has the Supabase dashboard (SQL editor, auth settings, cron). If migrating this backend, explicitly select its Supabase connection as `sourceIntegrationInstanceId`, separately from the target connection; projects must differ even when both belong to one integration. Lovable Cloud has no source Management API connection and must not borrow the target connection. If that backend is staying, this is a frontend and domain move only: skip the freeze and final copy and use the runbook's domain phases.

## Final-copy path

Prefer the **official Cloud Data export** (restore path) when available. The user generates a **new** export after the freeze (Cloud → Overview → Advanced settings); a rehearsal export is stale. Staticbot detects it at discovery and offers the restore-versus-replay choice; present it as usual. The helper replay path also preserves source user UUIDs and exportable password hashes, and checks Auth export completeness and target parity before application-data import. Incomplete exports, conflicting target users or unverifiable parity stop that path; prefer a clean target and never imply an atomic rollback of Auth writes. The helper reads with the source service-role key and is unaffected by the table-write freeze below. Source-helper deployment requires explicit source-change authorization. Use the discovery and handoff reports for concrete unsupported or unverified areas; never expose hashes or credentials in chat.

## Write freeze

Read [references/write-freeze.md](references/write-freeze.md). In short:

1. Capture the current table privileges and active cron jobs (query in the reference). Save the output in the state file; it generates the exact undo.
2. Apply the freeze SQL: revoke `INSERT/UPDATE/DELETE/TRUNCATE` on `public` tables from `anon`, `authenticated`, `service_role`; add restrictive deny policies on `storage.objects` writes; deactivate cron jobs. Review `SECURITY DEFINER` functions that write; they bypass the revokes.
3. Auth is not covered by table privileges. Disable new sign-ups in Lovable Cloud's authentication settings if available; otherwise record the freeze timestamp and, before reopening, check the source for users created after it.
4. Prove it with the probe in the reference. A write that normally succeeds for a signed-in test user must now fail with `permission denied`.

**Where the SQL runs matters.** If it goes through the Lovable agent, a migration file lands in the repository. On the replay path the final migration then replays the freeze into the target, and later Continuous Sync sees it as history. Prefer a SQL runner that does not commit to the repository. When the agent path is the only one, record the freeze commit SHA in the state file and always run the target repair below.

## Target repair after the final copy (always)

A database export taken after the freeze contains the freeze. After the final migration completes, the user runs the generated **target** undo in their own Supabase SQL editor (the target is customer-owned): the saved grants restored and the `staticbot_freeze_*` storage policies dropped. Keep cron jobs inactive on the target until reopening. Then check that the preview evidence has no blocking grant-gap problem and that a signed-in test user can write on the final migration's preview.

## Maintenance

- **A (default):** the maintenance page is a version of the production Staticbot stack; see the orchestrator's maintenance-versions reference. The `*.lovable.app` URL keeps serving the old app, which is why the freeze must hold.
- **B:** ask the Lovable agent to replace the app with a static maintenance screen and publish it. This covers the custom domain and `*.lovable.app` at once. Afterwards, revert that commit in Lovable before resuming development so it never syncs to production.

## Sign-in continuity

Exportable password hashes can be preserved through official restore or helper replay; verify password and OAuth sign-in with known test accounts during rehearsal. Sessions do not carry over, so users sign in again. Retaining user UUIDs also preserves anonymous user records, but does not transfer their existing browser sessions or guarantee they can recover them. OAuth providers need the production domain in their redirect URLs and client secrets entered in the target Supabase dashboard (Staticbot lists them as follow-ups). Email links need the production site URL in target auth settings.

## After reopening

Keep the Lovable Cloud backend frozen through the recovery period. If the user keeps building in Lovable, its preview still talks to the frozen source, so writes in the builder preview fail. Once the recovery period ends, lift the source freeze (it then serves as a development database that contains real customer data) or point the builder at a separate development project. The user sets up Continuous Sync through the sync skill.
