# Migration Workflow

The live Staticbot tool schemas and `pendingAction` response are authoritative.

## Prepare

1. Identify the source type: `LOVABLE_SUPABASE`, `BOLT_SUPABASE`, `FIREBASE`, `BASE44_SUPABASE`, or `BASE44_NATIVE`.
2. Call `list_integration_instances`. Use returned GitHub, Supabase, and Base44 instance IDs; do not invent identifiers.
3. Staticbot discovers Supabase source metadata internally. Never ask the user for source or target API keys. For a `BASE44_SUPABASE` repo containing placeholders, pass its `*.base44.app` URL as `sourceDeployedUrl`; the keys remain server-side.
4. Ask whether the target is `SUPABASE_CLOUD` or `SUPABASE_SELF_HOSTED`. For cloud, call `list_supabase_projects`; Staticbot rejects a discovered source that matches the selected target before migration writes begin.
5. Use `list_templates`/`get_template`, or `create_template` so Staticbot analyzes the supplied repository.

## Run

1. Call `create_migration` only after the required source, target, integrations, and template are known.
2. Poll `get_migration` until discovery pauses. Fetch `get_migration_jobs`, present the inventory, and wait for explicit approval before `confirm_migration`.
3. Route every non-null `pendingAction` to the matching tool and use the IDs/options it returns:
   - `REVIEW_TARGET_CONFLICTS` → present `targetConflictReport`; call `clean_migration_target` only after exact-scope/project confirmation, or call `confirm_migration` only after the user explicitly declines cleanup
   - `WAIT_FOR_TARGET_CLEANUP` → poll `get_migration`; do not resolve another gate yet
   - `RETRY_TARGET_CLEANUP` → explain the failure and use `retry_migration_job`; never skip a cleanup prerequisite
   - `CHOOSE_MIGRATION_STRATEGY` → present `preFlightGate.actions` and consequences, then call `confirm_migration` with the user's exact `gateChoice`
   - `CONFIRM` → `confirm_migration`
   - `RETRY_OR_SKIP` → inspect jobs, then `retry_migration_job` or confirmed `skip_migration_job`
   - `PROVIDE_BASE44_SECRETS` → `provide_base44_secrets`
   - `RESOLVE_SCHEMA_GAP` → `resolve_schema_gap`
   - `CHOOSE_DATA_IMPORT_METHOD` → `choose_data_import_method`
   - `CHOOSE_BACKEND_SWITCHOVER` → `choose_backend_switchover`
   - `CHOOSE_FRONTEND_DEPLOY` → `choose_frontend_deploy`
   - `COMPLETE_MANUAL_JOB` → `complete_migration_job`
4. Use `create_migration_preview` when the user wants verification before switchover. A completed migration can still have an in-progress preview deployment; monitor both when preview readiness is part of the requested outcome.

Target cleanup is available only before execution starts and only for Supabase Cloud targets. `DATABASE` deletes target database objects, migration history, and authentication data; `STORAGE` deletes every bucket and stored file; `PROJECT` performs both. Copy `targetConflictReport.confirmationProjectRef` exactly into the destructive call.

Treat package download URLs and passwords as secrets. Fetch a package only when requested.
