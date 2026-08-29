# Continuous Sync Workflow

1. Use `list_connected_projects` to resolve the project, then `get_connected_project` for its current mode and linkage.
2. Use `list_sync_runs` to avoid duplicating an active run.
3. Call `trigger_sync` only when authorized. Omit `commitSha` for the configured branch tip; otherwise use the exact user-requested or Staticbot-returned commit.
4. Poll `get_sync_run` every 10–20 seconds and use `get_sync_run_jobs` for details.
5. On `PAUSED_FOR_REVIEW`, present the returned destructive diff and SQL. Ask whether to apply or skip destructive changes, then call `confirm_sync_run` with the user's choice.
6. On failure, inspect the run and jobs. Use `retry_sync_run` when the failure is plausibly transient or corrected. Use `skip_sync_run` only after explaining which work will be omitted and receiving confirmation.
7. Change automatic behavior through `set_connected_project_sync_mode` only after confirming the exact mode.

Report the exact `fromRepoVersion`/`toCommitSha` or equivalent version fields returned by Staticbot. Do not reconstruct them from branch names.
