# Staticbot Migration Automation Guide

This guide teaches Claude Code how to run a Supabase migration end-to-end using the Staticbot MCP.

> **Firebase migrations**: This guide covers the Lovable/Supabase migration path (8 phases). Firebase migrations use a different pipeline (5 phases: Discovery → Schema Design → Data Import → Auth Migration → Storage Migration) and require a Firebase service account JSON instead of Supabase credentials. The same MCP tools apply — use `create_migration` with the appropriate `sourceType`.

## Prerequisites

- Staticbot MCP configured with `STATICBOT_API_KEY` and `STATICBOT_API_URL`
- Source Supabase project URL and anon key (from the Lovable/Supabase dashboard)
- A target Supabase project created (you need the project ref)
- Supabase integration connected in the Staticbot dashboard (OAuth)

## Full Automated Migration Flow

### Step 1: Gather Information

```
list_integration_instances()   → find supabaseIntegrationInstanceId
list_templates()               → find the right templateId
```

Ask the user for:
- `sourceSupabaseUrl` (e.g., `https://abcdef.supabase.co`)
- `sourceSupabaseAnonKey`
- `targetSupabaseProjectRef` (the subdomain part)
- `lovableProjectId` (UUID from the Lovable project URL, needed for Lovable sync)

### Step 2: Create Migration

```
create_migration(
  name: "My Migration",
  sourceSupabaseUrl: "https://...",
  sourceSupabaseAnonKey: "eyJ...",
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

### Step 7: Handle Lovable Sync

After `DEPLOY_EXPORT_FUNCTION` completes, `MANUAL_SYNC_LOVABLE` becomes READY.

**With Chrome extension (hands-free):**
```
get_migration_jobs(id)  → find MANUAL_SYNC_LOVABLE, read its inputData for function_name
lovable_sync(functionName, lovableProjectId, migrationId, jobId)
```

If successful, the function URL is returned. Then:
```
complete_migration_job(jobId, functionUrl)
resume_migration(id)
```

**Without Chrome extension (manual step):**
1. Extract `function_name` from the MANUAL_SYNC_LOVABLE job's `inputData`
2. Derive the URL: `https://{sourceProjectRef}.supabase.co/functions/v1/{function_name}`
3. Tell the user: "Please open Lovable and type 'deploy staticbot edge function' in the chat"
4. Poll `validate_function_url(jobId, url)` every 20 seconds until status is `ok`
5. Then: `complete_migration_job(jobId, functionUrl)` and `resume_migration(id)`

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
