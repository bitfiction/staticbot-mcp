---
name: live-migrate-base44-app
description: Base44-specific steps for a live cutover with live-migrate-ai-built-app - write freeze for native Base44 entities, backend functions, automations and sign-ups, the discovery-before-freeze ordering that keeps entity security rules intact, sign-in changes, and Base44 maintenance options. Use together with live-migrate-ai-built-app when the live app was built with Base44.
---

# Live-Migrate a Base44 App

Load [live-migrate-ai-built-app](../live-migrate-ai-built-app/SKILL.md) first; it owns the phases, gates, and domain switch. This skill fills in the Base44 parts. Everything below is done by the user in the Base44 dashboard. Base44 exposes no freeze API to Staticbot, so give exact steps and wait for confirmation.

## Identify the source shape

- **Native Base44** (`BASE44_NATIVE`): entities, auth, files, and functions live in Base44. Staticbot reads them through Base44's API, translates entity schemas and **entity security rules** into Supabase tables and RLS policies, and replaces the SDK with the Staticbot shim.
- **Base44 on the user's own Supabase** (`BASE44_SUPABASE`): freeze the Supabase side with the [Lovable write-freeze reference](../live-migrate-lovable-app/references/write-freeze.md) (the SQL is plain Supabase), and freeze the Base44 functions and automations below as well.

## Critical ordering: discovery before the freeze (native)

Staticbot translates each entity's security rules into target RLS **from the discovery snapshot**, and later phases reuse that snapshot. If discovery runs after entity rules are changed to deny writes, the target inherits the denial. So in phase 4:

1. Create the final migration **before** applying the freeze and let discovery finish (`PAUSED_FOR_APPROVAL`). Do not confirm yet.
2. Apply and prove the freeze.
3. Then `confirm_migration`. The data import reads entities after the freeze, which is what makes the copy fresh.

If discovery had to be re-run after the freeze (for example after a failure), stop: the target policies may be wrong. Compare the target's entity write behaviour against the rehearsal before reopening.

Rehearse this exact order in phase 2, including a data import while frozen, to prove Staticbot's reads still work under the freeze.

## Write freeze (native)

Fill one writer-table row per item. Test every probe with a **non-admin** test account; the app owner and admins may bypass rules.

1. **Entity writes:** in each entity's security settings, restrict create, update, and delete to admins only (or nobody). Keep read rules unchanged. Save a screenshot or copy of the original rules for the undo.
2. **Backend functions:** service-role code bypasses entity rules ([Base44 docs](https://docs.base44.com/developers/backend/resources/entities/security)). Disable or unpublish functions that write, or disable their callers (webhooks, payment callbacks). Arrange for providers to retry later instead of accepting and dropping events.
3. **Automations:** pause scheduled and event-driven automations. Record which ones were active.
4. **Sign-ups and profile changes:** switch the app to invite-only or private for the window if the plan allows. Otherwise record the freeze timestamp and check for users created after it before reopening.
5. **Uploads:** covered by 1–2 when uploads are tied to entity records; test one anyway.
6. **Probe:** as the non-admin test user, on the builder's default Base44 URL (not the custom domain), try to edit a record they normally can edit and to upload a file. Both must fail. Record the result.

Undo in reverse order, from the saved originals: entity rules, functions, automations, sign-up setting.

## Maintenance

- **A (default):** the maintenance page is a version of the production Staticbot stack; see the orchestrator's maintenance-versions reference. The default Base44 URL keeps serving the old app, which is why the freeze must hold.
- **B:** ask the Base44 agent to replace the app with a static maintenance screen and publish it; this covers both URLs. Revert it in Base44 after the move.

## Sign-in and other changes to announce

Base44 does not expose password hashes. Migrated users are created by email and sign in by email code or magic link (or their OAuth provider, once its client secret is entered in the target Supabase dashboard). Put this in the advance notice and the completion message. Test delivery to a few real mailbox providers during rehearsal. Also check Staticbot's follow-ups for secrets to provide (`PROVIDE_BASE44_SECRETS` is resolved in the browser, never in chat), connectors to replace, and asset URLs stored in data rows that still point at Base44.

## After reopening

Keep the Base44 app frozen through the recovery period. Base44-hosted files referenced from data are copied to target storage, but URLs inside data rows are not rewritten automatically. Resolve the follow-up list before retiring Base44. If the user keeps building in Base44, Continuous Sync carries changes forward through the shim branch; set it up with the sync skill.
