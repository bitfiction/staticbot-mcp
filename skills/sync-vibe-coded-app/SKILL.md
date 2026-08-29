---
name: sync-vibe-coded-app
description: Keep a migrated Base44, Lovable, Bolt, Firebase, or Supabase application synchronized with customer-owned infrastructure using Staticbot Continuous Sync. Use when the user keeps editing in the original builder or Git repository and wants changes reviewed and applied to independent Supabase and frontend hosting.
---

# Sync a Vibe-Coded App

Use Staticbot MCP tools when available. If they are unavailable, read the sibling [direct API skill](../staticbot/SKILL.md) before using its REST helper.

Read [references/sync-workflow.md](references/sync-workflow.md) for the tool sequence.

- Inspect the connected project, current sync mode, webhook state, last synced version, and recent runs before triggering or changing anything.
- A request to review sync changes does not authorize applying them. Trigger a new run only when requested.
- Use repository versions returned by Staticbot; do not infer commits or claim a diff was applied before the run completes.
- When a run is `PAUSED_FOR_REVIEW`, fetch its jobs and present the destructive SQL/diff inventory. Ask whether to apply or skip destructive operations before `confirm_sync_run`.
- Inspect failures before retrying. Explain exactly what would be skipped and obtain explicit confirmation before `skip_sync_run`.
- Confirm the requested mode before `set_connected_project_sync_mode`; `AUTOMATIC`, `MANUAL`, `PAUSED`, and `ARCHIVED` have materially different behavior.
- Frontend changes deploy to the target already selected by Staticbot from repository analysis and project configuration. Do not replace it with an agent-chosen AWS or Cloudflare target.

Poll at a moderate interval and stop at terminal status or a review gate. Finish with source/target versions, applied and skipped changes, frontend status/URL, and manual follow-up.
