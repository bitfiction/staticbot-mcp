# Migration Workflow

The live Staticbot tool schemas and `pendingAction` response are authoritative.

## Prepare

1. Call `get_account_status` and follow its `pendingAction`. Stop on `CONNECT_SOURCE_CONTROL` / `CONNECT_DATABASE`; on `CHOOSE_PATH`, confirm the user wants a migration rather than hosting before continuing.
2. Identify the source type: `LOVABLE_SUPABASE`, `BOLT_SUPABASE`, `FIREBASE`, `BASE44_SUPABASE`, or `BASE44_NATIVE`. `FIREBASE` cannot be created through MCP tools — it needs a Google service-account private key, which no tool accepts. Hand the user `https://app.staticbot.dev/migrations/new/firebase` and stop; never ask for the key in the conversation. Every other source type proceeds normally.
3. Call `list_integration_instances`. Use returned GitHub, Supabase, and Base44 instance IDs; do not invent identifiers.
4. Call `list_source_repositories` with no arguments — it covers every connected GitHub and GitLab account — and match the current client/project context against `fullName` or `webUrl`. Private repositories are supported. Use one unambiguous match without asking; when several candidates are plausible, present them with their `sourceLabel` (the account each is hosted in), since the same name in two accounts is two different repositories. If there are no sources, direct the user to `https://app.staticbot.dev/integrations`, then retry. Never claim a public repository is required.
5. Staticbot discovers Supabase source metadata internally. Never ask the user for source or target API keys. For a `BASE44_SUPABASE` repo containing placeholders, pass its `*.base44.app` URL as `sourceDeployedUrl`; the keys remain server-side.
6. Ask whether the target is `SUPABASE_CLOUD` or `SUPABASE_SELF_HOSTED`. For cloud, call `list_supabase_projects`. The user may select an existing healthy project or create a customer-owned target: call `list_supabase_organizations` and `list_supabase_regions`, present the exact name/organization/region, obtain explicit confirmation, then call `create_supabase_project`. Poll `get_supabase_project_status` until `healthy=true`; slow provisioning or a failed poll must never cause a second project to be created. Staticbot rejects a discovered source that matches the selected target before migration writes begin.
7. Use `list_templates`/`get_template`, or `create_template` so Staticbot analyzes the resolved repository — pass the repository's `integrationInstanceId` as `sourceControlIntegrationInstanceId` when it came from `list_source_repositories`.

## Run

1. Call `create_migration` only after the required source, target, integrations, and template are known.
2. Migrations created here default to `gatingLevel: GUARDED` (stop at every choice and before every phase). Pass `STREAMLINED` to `create_migration`, or call `set_migration_gating_level`, only when the user explicitly asks for fewer stops. Poll `get_migration` until discovery pauses. Fetch `get_migration_discovery_report` and `get_migration_jobs`, present the report including unknown coverage and approval blockers, and wait for explicit approval. Send its exact `revisionId` as `approvedRevisionId` to `confirm_migration`; on a stale-plan 409, review the fresh report and obtain approval again.
3. Route every non-null `pendingAction` to the matching tool and use the IDs/options it returns:
   - `REVIEW_TARGET_CONFLICTS` → call `get_clean_target_plan` and present its live rows and `confirmationProjectRef` (the migration's own `targetConflictReport` is a discovery-time snapshot); call `clean_migration_target` only after exact-scope/project confirmation, or call `confirm_migration` only after the user explicitly declines cleanup
   - `WAIT_FOR_TARGET_CLEANUP` → poll `get_migration`; do not resolve another gate yet
   - `RETRY_TARGET_CLEANUP` → explain the failure and use `retry_migration_job`; never skip a cleanup prerequisite
   - `CHOOSE_MIGRATION_STRATEGY` → present `preFlightGate.actions` and consequences, then call `confirm_migration` with the user's exact `gateChoice`. A `RECHECK_*` action (e.g. `RECHECK_EXPORT` on `REPLAY_DATA_DEPENDENCY`, after the user has created a Lovable Cloud Data export) is not a gate choice: call `recheck_migration_gate`, then poll
   - `CONFIRM` → confirming **starts** the migration (tables and data are written to the target). Present the plan and call `confirm_migration` only after the user approves starting — even right after they answered `CHOOSE_MIGRATION_STRATEGY`. At every gating level, including STREAMLINED, that answer only builds the plan; it is not approval to start, so never chain the two calls
   - `REVIEW_PHASE` → the migration stopped before a phase (GUARDED). Show the job's `title`, `body` and `job_summary`, and call `complete_migration_job` only when the user says to continue
   - `REVIEW_DATA_ACCESS` → some Base44 entities have no access rules (GUARDED). Show the job's `entities` (flag `looks_sensitive`) and `options`, ask who may read and change them, and pass the answer as `accessDefault` / `accessOverrides` to `complete_migration_job`. Never choose for the user
   - `RESUME` → the migration is paused and waiting on a person; say what it is waiting for and call `resume_migration` only after the user agrees
   - `RETRY_OR_SKIP` → inspect jobs, then `retry_migration_job` or confirmed `skip_migration_job`
   - `PROVIDE_BASE44_SECRETS` / `PROVIDE_SECRETS` → **no tool; the user resolves this in a browser.** The step takes the values of the customer's own third-party credentials, which cannot travel as tool arguments. `pendingAction.endpoint` is null; give the user `pendingAction.url` (it opens the migration's App secrets tab) and show `pendingAction.detail` verbatim, then keep polling `get_migration` — saving in that tab continues the migration. Never ask for the secret values in the conversation, and do not accept them if the user offers them anyway — no tool takes them and the API refuses them over an MCP connection. `get_app_secrets` says which are still missing and what each is for. `PROVIDE_SECRETS` (Lovable/Supabase sources) blocks nothing, so the migration keeps going meanwhile
   - `COMPLETE_MANUAL_JOB` on a provide-secrets step → every secret already has a value; `complete_migration_job` continues it without sending any
   - `RESOLVE_SCHEMA_GAP` → `resolve_schema_gap`
   - `CHOOSE_DATA_IMPORT_METHOD` → `choose_data_import_method`
   - `CHOOSE_BACKEND_SWITCHOVER` → `choose_backend_switchover`
   - `CHOOSE_FRONTEND_DEPLOY` → `choose_frontend_deploy`
   - `COMPLETE_MANUAL_JOB` → for `MANUAL_SYNC_LOVABLE` / `MANUAL_SYNC_BASE44`, give the user the deploy instruction from the job, then poll `get_migration`: Staticbot completes the step by itself once the export function answers. `validate_function_url` checks immediately and completes the step when reachable (`completed: true` means done — do not also call `complete_migration_job`). For other manual jobs → `complete_migration_job`
   - A step or gate that turns out to be already completed (the call returns ok or "already chosen") is success: re-fetch the migration and follow the new `pendingAction`
4. Use `create_migration_preview` when the user wants verification before switchover. A completed migration can still have an in-progress preview deployment; monitor both when preview readiness is part of the requested outcome.

Target cleanup is available only before execution starts and only for Supabase Cloud targets. `DATABASE` deletes target database objects, migration history, and authentication data; `STORAGE` deletes every bucket and stored file; `PROJECT` performs both. Copy `targetConflictReport.confirmationProjectRef` exactly into the destructive call.

Treat package download URLs and passwords as secrets. Fetch a package only when requested.
