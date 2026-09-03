# Tool annotations

Every tool declares `readOnlyHint`, `destructiveHint` and `openWorldHint`. OpenAI's plugin review
requires all three, and a client uses them to decide how much confirmation a call needs.

50 tools: **21 read-only**, **13 destructive**, **18 that can change public or external state**.

## How each is decided

- **`readOnlyHint: true`** — the tool strictly fetches, lists or retrieves and changes nothing.
  `recheck_dns_verification` and `validate_function_url` look read-only but are not: rechecking
  updates stored verification state, so it is marked `false`.
- **`destructiveHint: true`** — the outcome cannot be undone by calling another tool. Creating things
  is not destructive; replacing or discarding is.
- **`openWorldHint: true`** — the call changes state the public can see: what a website serves, or
  records in a live DNS zone, or can advance work that changes an external system. Listing projects
  from an integration does not count; the hint is about writing.

Deliberately **not** destructive, and worth knowing why:

- `retry_migration_job` / `retry_sync_run` re-run work that already failed.
- `resume_migration` releases queued work, but the migration can be paused again.
- `create_deployment` prepares a deployment; `start_deployment` is what publishes.

## Justifications for destructive tools

The submission form requires a justification naming what is irreversible and what safeguards exist.

| Tool | Irreversible outcome | Safeguard |
|---|---|---|
| `push_dns_to_cloudflare` | Writes records into the customer's live Cloudflare zone and can overwrite existing ones. A wrong record takes the domain offline until corrected. | Pushes only deployment-owned records, never nameservers or mail records; reports every per-record result. Requires an exact `domainId` from an `OFFER_CLOUDFLARE_PUSH` item. |
| `rollback_website` | Replaces what is publicly served with an earlier version; the replaced version is only recoverable by rolling forward again. | Requires an exact version from `list_rollback_versions`; the tool description requires confirmation. |
| `redeploy_website` | Replaces the publicly served website build and may pull a newer version first. | The deployment ID and optional latest-version choice bound the operation. |
| `confirm_migration` | Starts the migration proper — applies schema and imports data into the customer's target database. | Discovery results are presented for review first; this is the gate that turns a plan into writes. |
| `clean_migration_target` | Permanently deletes target database/authentication data, Storage buckets and files, or both. | Requires an exact scope and the target project ref returned by `get_migration`; the tool description requires presenting consequences and obtaining explicit confirmation. |
| `skip_migration_job` | Marks a pipeline job completed without running it. A skipped job cannot be un-skipped and its work is never performed. | Staticbot explains the failure before an agent may skip; retry is the non-destructive alternative. |
| `complete_migration_job` | Irreversibly records a manual job as completed and lets dependent migration work proceed. | The caller must use the exact READY job and, for Lovable sync, validate the function URL first. |
| `choose_data_import_method` | Commits the migration to an automated or manual import path that may write target data. | The tool description requires presenting both paths and obtaining the user's choice. |
| `choose_backend_switchover` | Commits a switchover strategy that can replace repository environment configuration or skip the change permanently. | The tool description requires presenting every strategy and obtaining the user's choice. |
| `choose_frontend_deploy` | Commits the migration to continuous sync, a Staticbot deployment, or a permanent skip. | The tool description requires presenting all deployment choices and obtaining the user's choice. |
| `confirm_sync_run` | Applies the sync run's SQL to the customer's database, which can drop or rewrite data. | Destructive statements are surfaced for review first; this tool is the approval step and must not be called before the user has seen them. |
| `skip_sync_run` | Marks a sync run handled without applying it; source and target diverge permanently. | The run's contents are inspectable via `get_sync_run_jobs` beforehand. |
| `resolve_schema_gap` | The `abort` action ends the migration permanently. | `recheck` is the safe alternative and the user chooses; the tool description requires asking first. |

## Keeping this honest

A new tool must be classified when it is added — the annotations are part of the contract a client
reasons about, not documentation. Verify what is actually served rather than what the source says:

```bash
npm run build && node -e "…listTools()…"   # see CONTRIBUTING.md
```

Getting these wrong hurts in both directions: too permissive risks review rejection and unconfirmed
destructive calls, too restrictive makes clients refuse to call safe tools.
