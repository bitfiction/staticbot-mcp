# Staticbot Migration Automation Guide

This guide teaches Claude Code how to run a migration end-to-end using the Staticbot MCP.

> **Supported source types**: Lovable Supabase (`LOVABLE_SUPABASE`), Bolt Supabase (`BOLT_SUPABASE`), Firebase (`FIREBASE`), Base44 Supabase (`BASE44_SUPABASE`), Base44 Native (`BASE44_NATIVE`). This guide covers the Lovable/Supabase path (8 phases) as the default. Other source types follow the same MCP tools but with different pipeline behavior — see platform-specific notes throughout.

## Prerequisites

- Staticbot MCP configured with `STATICBOT_API_KEY` and `STATICBOT_API_URL`
- For Supabase-backed sources: source Supabase project URL and anon key (from the Lovable/Bolt/Base44 dashboard, or auto-extracted via `parse_source_keys`/`scan_deployed_url`)
- For Base44 Native: a Base44 integration connected in the Staticbot dashboard
- A target Supabase project created (you need the project ref)
- Supabase integration connected in the Staticbot dashboard (OAuth)

## Full Automated Migration Flow

### Step 1: Gather Information

```
list_integration_instances()   → find supabaseIntegrationInstanceId, githubIntegrationInstanceId, sourceIntegrationInstanceId (for Base44 Native)
list_templates()               → find the right templateId
```

Ask the user for:
- Their GitHub repo URL and source platform
- `targetSupabaseProjectRef` (the subdomain part)
- For Lovable: `lovableProjectId` (UUID from the Lovable project URL)
- For Supabase-backed sources: `parse_source_keys(githubRepoUrl)` to auto-extract credentials, or ask the user
- For Base44 apps with placeholder .env files: `scan_deployed_url(deployedUrl)` to extract inlined keys from the JS bundle

### Step 2: Create Migration

**Lovable/Bolt/Base44 Supabase:**
```
create_migration(
  name: "My Migration",
  sourceSupabaseUrl: "https://...",
  sourceSupabaseAnonKey: "eyJ...",
  sourceType: "LOVABLE_SUPABASE",   // or BOLT_SUPABASE, BASE44_SUPABASE
  supabaseIntegrationInstanceId: "...",
  templateId: "...",
  targetSupabaseProjectRef: "..."
)
```

**Base44 Native (no source Supabase):**
```
create_migration(
  name: "My Base44 Migration",
  sourceType: "BASE44_NATIVE",
  sourceIntegrationInstanceId: "...",  // Base44 integration instance
  supabaseIntegrationInstanceId: "...",
  templateId: "...",
  targetSupabaseProjectRef: "..."
)
```

Note the migration ID from the response.

### Step 3: Monitor Discovery (Phase 1)

Poll every 10 seconds until status is `PAUSED_FOR_APPROVAL`:

```
get_migration(id)  → check status
```

Discovery inventories the source project: database schemas, extensions, edge functions, storage buckets.

### Step 4: Confirm Migration

```
confirm_migration(id)
```

This starts the actual migration pipeline.

### Step 5: Monitor Phase 2 (DB Migration)

Poll `get_migration(id)` every 10 seconds. Phase 2 applies SQL migrations automatically.

If migration pauses with `PAUSED_FOR_USER_ACTION`:
```
get_migration_jobs(id)  → find the FAILED job
```
Then either `retry_migration_job(jobId)` or `skip_migration_job(jobId)`.

### Step 6: Choose Data Import Method (Phase 3)

When you see a `MANUAL_CHOOSE_DATA_IMPORT_METHOD` job in READY status:

```
choose_data_import_method(migrationId, jobId, "automated")
resume_migration(id)
```

This creates the automated job chain: DEPLOY → SYNC → CALL → COPY_STORAGE → SECRETS → CRON → AUTH_IDENTITIES → CLEANUP.

### Step 7: Handle Lovable/Base44 Sync

After `DEPLOY_EXPORT_FUNCTION` completes, a manual sync job becomes READY:
- `MANUAL_SYNC_LOVABLE` for Lovable sources
- `MANUAL_SYNC_BASE44` for Base44 Supabase sources

**Lovable with Chrome extension (hands-free):**
```
get_migration_jobs(id)  → find MANUAL_SYNC_LOVABLE, read its inputData for function_name
lovable_sync(functionName, lovableProjectId, migrationId, jobId)
```

If successful, the function URL is returned. Then:
```
complete_migration_job(jobId, functionUrl)
resume_migration(id)
```

**Lovable without Chrome extension (manual step):**
1. Extract `function_name` from the MANUAL_SYNC_LOVABLE job's `inputData`
2. Derive the URL: `https://{sourceProjectRef}.supabase.co/functions/v1/{function_name}`
3. Tell the user: "Please open Lovable and type 'deploy staticbot edge function' in the chat"
4. Poll `validate_function_url(jobId, url)` every 20 seconds until status is `ok`
5. Then: `complete_migration_job(jobId, functionUrl)` and `resume_migration(id)`

**Base44 Supabase (manual sync):**
1. Tell the user: "Please sync your Base44 project from GitHub in the Base44 dashboard"
2. Once the user confirms: `complete_migration_job(jobId)` (no functionUrl needed)
3. Then: `resume_migration(id)`

### Step 8: Monitor Phases 4-6

These are fully automated:
- **Phase 4**: Edge Functions — deploys edge functions to the target
- **Phase 5**: Storage Buckets — creates storage buckets (idempotent)
- **Phase 6**: Auth Config — migrates auth configuration

Poll `get_migration(id)` every 15 seconds. Handle any failures with retry/skip.

### Step 9: Choose Backend Switchover (Phase 7)

When `MANUAL_CHOOSE_BACKEND_SWITCHOVER` is READY:

```
choose_backend_switchover(migrationId, jobId, "auto", "switch-fully-to-supabase")
resume_migration(id)
```

This replaces the old Supabase env vars in the GitHub repo with the target values.

**Platform-specific behavior:**
- **Lovable/Bolt**: `auto` rewrites `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in the GitHub repo.
- **Base44 Supabase**: `auto` creates `MANUAL_SWITCH_BASE44_SECRETS` jobs — Base44 manages env vars on its platform, not in GitHub. The user updates secrets in Base44's UI.
- **Base44 Native**: Phase 7 is fully automated — installs the `@bitfiction/base44-supabase-shim` runtime into the repo. No manual CHOOSE gate.

### Step 10: Choose Frontend Deploy (Phase 8)

When `MANUAL_CHOOSE_FRONTEND_DEPLOY` is READY:

```
choose_frontend_deploy(migrationId, jobId, "continuous-sync", "setup-continuous-sync")
resume_migration(id)
```

This sets up automatic sync between the GitHub repo and the target.

### Step 11: Complete

Poll until status is `COMPLETED` or `COMPLETED_WITH_ERRORS`. Report the final status and any skipped/failed jobs.

## Error Handling

- **PAUSED_FOR_USER_ACTION**: A job failed. Use `get_migration_jobs(id)` to find it, then `retry_migration_job(jobId)` or `skip_migration_job(jobId)`.
- **Best-effort jobs** (COPY_STORAGE, MIGRATE_SECRETS, MIGRATE_CRON_JOBS, MIGRATE_AUTH_IDENTITIES): These always succeed at the job level but may report partial failures in their outputData.
- After fixing a failure, call `resume_migration(id)` to continue.

## Polling Strategy

| Phase | Interval | What to check |
|-------|----------|---------------|
| Discovery | 10s | `get_migration(id).status === "PAUSED_FOR_APPROVAL"` |
| Phase 2-6 | 15s | `get_migration(id).status` for terminal or paused states |
| Lovable sync | 20s | `validate_function_url` until `status === "ok"` |
| Phase 7-8 | 10s | `get_migration(id).status` for READY choice gates |
