# Continuous Sync Workflow

1. Use `list_connected_projects` to resolve the project, then `get_connected_project` for its current mode and linkage.
2. Use `list_sync_runs` to avoid duplicating an active run.
3. Call `trigger_sync` only when authorized. Omit `commitSha` for the configured branch tip; otherwise use the exact user-requested or Staticbot-returned commit.
4. Poll `get_sync_run` every 10–20 seconds and use `get_sync_run_jobs` for details.
5. On `PAUSED_FOR_REVIEW`, present the returned destructive diff and SQL. Ask whether to apply or skip destructive changes, then call `confirm_sync_run` with the user's choice.
6. On failure, inspect the run and jobs. Use `retry_sync_run` when the failure is plausibly transient or corrected. Use `skip_sync_run` only after explaining which work will be omitted and receiving confirmation.
7. Change automatic behavior through `set_connected_project_sync_mode` only after confirming the exact mode.

Report the exact `fromRepoVersion`/`toCommitSha` or equivalent version fields returned by Staticbot. Do not reconstruct them from branch names.

## Preview, live branch and webhook controls

1. Inspect `get_connected_project_operations` for exact branch targets, role permissions and shared
   webhook scope. Permissions alone do not prove feature flags or current workflow state allow an action.
2. For a preview rebuild, explain that it can replace the preview and provision infrastructure; call
   `build_connected_project_preview` only with the user's approval, then monitor branch previews.
3. For a migration-preview-to-live merge, obtain approval and call `sync_connected_project_to_live`
   with both inspected branch names. Monitor its returned run with the existing sync-run tools. An
   already-running result is not completion; do not queue duplicate work.
4. For cutting the cord, explain the current/live and builder branch targets, mirror-maintenance stop
   and potential production redeploy. Call `switch_connected_project_live_branch` only after explicit
   approval. If the switch persists but redeploy fails, report both facts.
5. For GitHub webhook setup/reset/disable, show all affected projects and the template count sharing
   the repository. Confirm the entire repository scope and pass the inspected configuration ID.
   Reset/disable cannot attest upstream deletion; preserve `remoteDeletionVerified: false`.

A changed-target 409 requires fresh inspection and approval, never an automatic replacement of the
expected branch or repository configuration. Do not change feature flags or roles to force an action.
