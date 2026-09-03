import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { ToolContext } from "../context.js";

/**
 * Registered on every transport. Bodies are unchanged from the original single-file server; the only
 * difference is that apiFetch and toText now arrive per call rather than closing over module state,
 * which is what lets one registry serve both the API-key stdio server and the hosted OAuth one.
 */
export function registerMigrationTools(server: McpServer, { apiFetch, toText }: ToolContext): void {
// ─── Migrations ──────────────────────────────────────────────────────────────

server.tool(
  "list_migrations",
  "List all migrations. Optionally filter by status. Migrations orchestrate moving a full project (database, auth, storage, edge functions) from a source platform (Lovable, Bolt, Firebase, Base44) to target Supabase infrastructure.",
  {
    status: z.enum(["PENDING", "IN_PROGRESS", "PAUSED_FOR_APPROVAL", "PAUSED_FOR_USER_ACTION", "PAUSED_BY_USER", "COMPLETED", "COMPLETED_WITH_ERRORS", "FAILED", "ARCHIVED"]).optional().describe("Filter by migration status"),
  },
  { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  async ({ status }) => {
    const qs = status ? `?status=${encodeURIComponent(status)}` : "";
    const data = await apiFetch(`/api/v1/migrations${qs}`);
    return { content: [{ type: "text", text: toText(data) }] };
  }
);

server.tool(
  "get_migration",
  "Get the current status and phase breakdown of a migration. The response includes all migration phases (Discovery, DB Migration, Data Import, Edge Functions, Storage Buckets, Auth Config, Backend Switchover, Preview & Verify, Continuous Sync, Download, Follow-ups) with their individual statuses, plus sourceType (LOVABLE_SUPABASE / BOLT_SUPABASE / FIREBASE / BASE44_SUPABASE / BASE44_NATIVE), targetType (SUPABASE_CLOUD / SUPABASE_SELF_HOSTED), and packageAvailable (true once the downloadable zip is ready — fetch via download_package).\n\n" +
  "**Self-navigating:** the response includes a `pendingAction` field that tells you the next action to take. New pre-flight states are explicit: REVIEW_TARGET_CONFLICTS → present `targetConflictReport`, then either call clean_migration_target after destructive confirmation or call confirm_migration only after the user explicitly declines cleanup; WAIT_FOR_TARGET_CLEANUP → poll; RETRY_TARGET_CLEANUP → call retry_migration_job (never skip cleanup); CHOOSE_MIGRATION_STRATEGY → present `preFlightGate.actions` and consequences, then call confirm_migration with the selected gateChoice. Other types: CONFIRM, RETRY_OR_SKIP, PROVIDE_BASE44_SECRETS, RESOLVE_SCHEMA_GAP, CHOOSE_BACKEND_SWITCHOVER, CHOOSE_DATA_IMPORT_METHOD, CHOOSE_FRONTEND_DEPLOY, COMPLETE_MANUAL_JOB. When `pendingAction` is null, poll only while the status is flowing.\n\n" +
  "The response exposes `preFlightGate` with backend-authored labels, consequences, export files, and the accepted choice IDs. It also exposes `targetConflictReport` with conflicting objects, cleanup scopes, `confirmationProjectRef`, and endpoint paths. Present these fields instead of inventing or defaulting a choice.\n\n" +
  "The response also includes `failureBanner` with categorised error info (category, title, body, severity, actionable, followupNote, retryable) when a job has a categorised failure. Use this to present richer error feedback. When `retryable=false`, prefer skip_migration_job or an AI-assisted fix over repeating deterministic SQL that will fail again; `retryable=null` means the cause may be environmental.\n\n" +
  "**Polling Phase 7 (Backend Switchover):** the response also includes `previewDeployment` (null until Phase 7 provisions one) with its own independent status. Important: the migration itself can be marked COMPLETED while `previewDeployment.status` is still IN_PROGRESS — the preview Terraform applies in the background. When babysitting a migration toward 'live preview ready', also poll `previewDeployment.status` until it reaches COMPLETED. Treat anything other than COMPLETED/FAILED/ABORTED/DESTROYED/CLEANED_UP as 'still progressing'. Use `previewDeployment.createdAt` to compute elapsed time so you can give the user a sense of progress without spamming this endpoint — once-every-5s is plenty.",
  {
    id: z.string().uuid().describe("Migration ID"),
  },
  { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  async ({ id }) => {
    const data = await apiFetch(`/api/v1/migrations/${id}`);
    return { content: [{ type: "text", text: toText(data) }] };
  }
);

server.tool(
  "confirm_migration",
  "Approve a migration after discovery, or resolve a pre-flight migration-strategy gate. Before calling, get the migration and present the discovery inventory. If `preFlightGate` is non-null, present every enabled action and its consequence verbatim, obtain the user's explicit choice, and pass that exact action ID as gateChoice. For USE_OFFICIAL_EXPORT, gateSelection may select an offered export file path; omit it to use the newest. Never infer a gate choice or bypass REVIEW_TARGET_CONFLICTS without discussing the detected target objects.",
  {
    id: z.string().uuid().describe("Migration ID"),
    gateChoice: z.string().min(1).optional().describe("Exact enabled action ID from get_migration.preFlightGate.actions. Required when pendingAction.type is CHOOSE_MIGRATION_STRATEGY; do not invent or default a value."),
    gateSelection: z.string().optional().describe("For USE_OFFICIAL_EXPORT only: a path from preFlightGate.exportFiles. Omit to restore the newest detected export."),
  },
  { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
  async ({ id, gateChoice, gateSelection }) => {
    const body = gateChoice ? { gateChoice, ...(gateSelection ? { gateSelection } : {}) } : undefined;
    const data = await apiFetch(`/api/v1/migrations/${id}/confirm`, {
      method: "POST",
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { content: [{ type: "text", text: toText(data) }] };
  }
);

server.tool(
  "clean_migration_target",
  "Destructively clean conflicting objects from a Supabase Cloud migration target before execution starts. DATABASE deletes user-created database objects, Supabase migration history, and existing authentication users/sessions while preserving Storage. STORAGE empties and deletes every Storage bucket and file while preserving database/auth data. PROJECT performs both cleanups. This cannot be undone. Before calling, get the migration, present the exact scope consequences and targetConflictReport.confirmationProjectRef, and obtain explicit user confirmation for that exact project and scope. Copy the returned confirmationProjectRef into confirmProjectRef; never guess it. The migration remains paused after cleanup.",
  {
    id: z.string().uuid().describe("Migration ID"),
    scope: z.enum(["DATABASE", "STORAGE", "PROJECT"]).describe("Exact destructive scope explicitly approved by the user"),
    confirmProjectRef: z.string().min(1).describe("Exact targetConflictReport.confirmationProjectRef repeated after explicit user confirmation"),
  },
  { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
  async ({ id, scope, confirmProjectRef }) => {
    const data = await apiFetch(`/api/v1/migrations/${id}/clean-target`, {
      method: "POST",
      body: JSON.stringify({ scope, confirmProjectRef }),
    });
    return { content: [{ type: "text", text: toText(data) }] };
  }
);

server.tool(
  "resume_migration",
  "Resume a migration that is PAUSED_BY_USER or PAUSED_FOR_USER_ACTION. Use this after the user has completed the required manual step (e.g. DNS configuration, backend switchover review).",
  {
    id: z.string().uuid().describe("Migration ID"),
  },
  { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  async ({ id }) => {
    const data = await apiFetch(`/api/v1/migrations/${id}/resume`, { method: "POST" });
    return { content: [{ type: "text", text: toText(data) }] };
  }
);

server.tool(
  "pause_migration",
  "Pause a running migration. The current in-progress job will finish, but no new jobs will be started. Use resume_migration to continue later.",
  {
    id: z.string().uuid().describe("Migration ID"),
  },
  { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  async ({ id }) => {
    const data = await apiFetch(`/api/v1/migrations/${id}/pause`, { method: "POST" });
    return { content: [{ type: "text", text: toText(data) }] };
  }
);

server.tool(
  "get_migration_jobs",
  "Get all jobs for a migration. Jobs are the individual work units within each phase (e.g. 'migrate_schema', 'import_data', 'deploy_edge_function_X'). Use this to understand what's happening at a granular level, diagnose failures, or find a jobId for retry/skip. For IN_PROGRESS long-running jobs (e.g. CALL_EXPORT_TO_TARGET on multi-table sources), each job's `progressMessage` field carries a human-readable subtitle like \"Exporting table 'startups' (8/10)\" so you can report concrete progress without waiting for completion.",
  {
    id: z.string().uuid().describe("Migration ID"),
  },
  { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  async ({ id }) => {
    const data = await apiFetch(`/api/v1/migrations/${id}/jobs`);
    return { content: [{ type: "text", text: toText(data) }] };
  }
);

server.tool(
  "retry_migration_job",
  "Retry a failed migration job. The job must be in FAILED status. It will be reset to READY and picked up by the worker again. Use get_migration_jobs first to find the failed job's ID and error message.",
  {
    jobId: z.string().uuid().describe("Migration job ID (from get_migration_jobs)"),
  },
  { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  async ({ jobId }) => {
    const data = await apiFetch(`/api/v1/migrations/jobs/${jobId}/retry`, { method: "POST" });
    return { content: [{ type: "text", text: toText(data) }] };
  }
);

server.tool(
  "skip_migration_job",
  "Skip a migration job that is blocking progress. The job will be marked as SKIPPED and dependent jobs will proceed. Use this when a job is non-critical (e.g. an edge function that can be deployed manually later) or when retry won't help.",
  {
    jobId: z.string().uuid().describe("Migration job ID (from get_migration_jobs)"),
  },
  { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
  async ({ jobId }) => {
    const data = await apiFetch(`/api/v1/migrations/jobs/${jobId}/skip`, { method: "POST" });
    return { content: [{ type: "text", text: toText(data) }] };
  }
);

server.tool(
  "get_migration_deployments",
  "List all AWS deployments associated with a migration's infrastructure stack. Migrations that deploy to AWS (self-hosted Supabase) create deployments for the infrastructure provisioning.",
  {
    id: z.string().uuid().describe("Migration ID"),
  },
  { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  async ({ id }) => {
    const data = await apiFetch(`/api/v1/migrations/${id}/deployments`);
    return { content: [{ type: "text", text: toText(data) }] };
  }
);

server.tool(
  "create_migration",
  "Create a new migration. Starts a multi-phase pipeline: Discovery → DB Migration → Data Import → Edge Functions → Storage Buckets → Auth Config → Backend Switchover → Preview & Verify → Continuous Sync → Download → Follow-ups.\n\n" +
  "Two delivery modes via targetType:\n" +
  "  • SUPABASE_CLOUD (default) — Staticbot applies the migration end-to-end against a managed Supabase project you own. Requires targetSupabaseProjectRef plus the Supabase integration instance.\n" +
  "  • SUPABASE_SELF_HOSTED — Staticbot runs discovery + data export, then produces a downloadable AES-256-encrypted zip the user applies to their self-hosted Supabase (typically with Claude Code following the bundled CLAUDE.md). Skip target* params; once the GENERATE_PACKAGE job completes, call download_package to fetch the zip + password.\n\n" +
  "Source platforms via sourceType:\n" +
  "  • LOVABLE_SUPABASE (default) — Lovable-built apps on Supabase.\n" +
  "  • BOLT_SUPABASE — Bolt.new apps on Supabase (Phase 3 Lovable-specific steps are adjusted).\n" +
  "  • FIREBASE — Firebase-to-Supabase migration (different pipeline). Requires firebaseServiceAccountJson; the Git repo is optional.\n" +
  "  • BASE44_SUPABASE — Base44 apps backed by Supabase. If repository discovery cannot resolve the source, pass sourceDeployedUrl and Staticbot will inspect the deployed app server-side. Backend switchover updates Base44 platform secrets (not GitHub env vars).\n" +
  "  • BASE44_NATIVE — Base44 apps using @base44/sdk against Base44's managed backend (no source Supabase). Requires sourceIntegrationInstanceId (the Base44 integration). Discovery hits Base44's REST API, DDL is synthesised from entity schemas, and data is imported directly.\n\n" +
  "BEFORE calling this tool, follow these steps to gather the required parameters:\n" +
  "1. Ask the user for their source platform and GitHub repo URL (the repo is optional for FIREBASE). For FIREBASE, securely collect firebaseServiceAccountJson.\n" +
  "2. Ask the user whether the target is managed Supabase (SUPABASE_CLOUD) or their own self-hosted install (SUPABASE_SELF_HOSTED).\n" +
  "3. Call list_integration_instances — use the instance with type='supabase' as supabaseIntegrationInstanceId, type='github' as githubIntegrationInstanceId, and type='base44' as sourceIntegrationInstanceId (for BASE44_NATIVE).\n" +
  "4. Source Supabase metadata is discovered by Staticbot. For a BASE44_SUPABASE app whose repository contains placeholders, provide its deployed *.base44.app URL as sourceDeployedUrl. Never ask the user for Supabase API keys.\n" +
  "5. For SUPABASE_CLOUD only: call list_supabase_projects with the Supabase integration instance — ask the user which ACTIVE project to use as the target. Skip this step for SUPABASE_SELF_HOSTED.\n" +
  "6. For templateId: either ask the user to pick from list_templates, or create a new template from their repo using create_template.\n\n" +
  "IMPORTANT: Source and target Supabase projects must be different. Staticbot validates this after source discovery; if it reports a match, ask the user to choose another target.\n\n" +
  "After creation, the migration starts with a DISCOVERY job. Once discovery completes, it pauses (PAUSED_FOR_APPROVAL) — present the inventory to the user and call confirm_migration if they approve.",
  {
    name: z.string().describe("Human-readable name for this migration"),
    description: z.string().optional().describe("Optional human-readable migration description"),
    sourceType: z.enum(["LOVABLE_SUPABASE", "BOLT_SUPABASE", "FIREBASE", "BASE44_SUPABASE", "BASE44_NATIVE"]).optional().describe("Source platform. Defaults to LOVABLE_SUPABASE."),
    targetType: z.enum(["SUPABASE_CLOUD", "SUPABASE_SELF_HOSTED"]).optional().describe("Target delivery mode. SUPABASE_CLOUD (default) for managed Supabase; SUPABASE_SELF_HOSTED produces a downloadable package instead of applying to a target project."),
    sourceIntegrationInstanceId: z.string().uuid().optional().describe("Source integration instance ID. Required for BASE44_NATIVE (the Base44 integration from list_integration_instances). Omit for other source types."),
    supabaseIntegrationInstanceId: z.string().uuid().optional().describe("Supabase integration instance ID (from list_integration_instances). Required for SUPABASE_CLOUD; omit for SUPABASE_SELF_HOSTED."),
    templateId: z.string().uuid().describe("Template ID for the target infrastructure (from list_templates)"),
    targetSupabaseProjectRef: z.string().optional().describe("Target Supabase project reference (the subdomain part of the URL). Required for SUPABASE_CLOUD; omit for SUPABASE_SELF_HOSTED."),
    githubIntegrationInstanceId: z.string().uuid().optional().describe("GitHub integration instance ID for repo access"),
    targetSchemaName: z.string().optional().describe("Optional target Postgres schema name"),
    configOverrides: z.record(z.string()).optional().describe("Non-secret template configuration overrides. Do not place credentials here; connected integrations supply provider credentials."),
    firebaseServiceAccountJson: z.string().optional().describe("Firebase service-account JSON. Required for FIREBASE migrations; sent directly to Staticbot and treated as a secret."),
    sourceDeployedUrl: z.string().url().optional().describe("Deployed *.base44.app URL used only for legacy BASE44_SUPABASE source discovery. Staticbot extracts source metadata server-side and never returns keys."),
    packageOptions: z.object({
      includeEntityData: z.boolean().optional().describe("Include Base44 entity data. Defaults to true."),
      includeStorageFiles: z.boolean().optional().describe("Include Base44 storage files. Defaults to false."),
    }).optional().describe("Optional self-hosted package build options for BASE44_NATIVE migrations."),
  },
  { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  async (params) => {
    const sourceType = params.sourceType ?? "LOVABLE_SUPABASE";
    // For BASE44_NATIVE, validate sourceIntegrationInstanceId is provided
    if (sourceType === "BASE44_NATIVE" && !params.sourceIntegrationInstanceId) {
      return { content: [{ type: "text", text: JSON.stringify({
        error: "sourceIntegrationInstanceId is required for BASE44_NATIVE migrations. " +
          "Call list_integration_instances to find the Base44 integration instance ID."
      }, null, 2) }] };
    }

    const data = await apiFetch("/api/v1/migrations", {
      method: "POST",
      body: JSON.stringify(params),
    });
    return { content: [{ type: "text", text: toText(data) }] };
  }
);

server.tool(
  "download_package",
  "Fetch the downloadable migration package for a migration. Returns a presigned URL to the AES-256-encrypted zip plus the password to extract it.\n\n" +
  "Availability:\n" +
  "  • SUPABASE_SELF_HOSTED: this is the delivery mechanism. The user unzips with the password, runs Claude Code against the folder, and follows the bundled CLAUDE.md to apply the migration to their self-hosted Supabase.\n" +
  "  • SUPABASE_CLOUD: this is a portable backup of the applied migration (re-applicable to any Supabase later).\n\n" +
  "The package is ready once the GENERATE_PACKAGE job is COMPLETED — check via get_migration_jobs first. Calling before then returns 404. The download URL is time-limited; the password is shown only here, never logged.",
  {
    id: z.string().uuid().describe("Migration ID"),
  },
  { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  async ({ id }) => {
    const data = await apiFetch(`/api/v1/migrations/${id}/download-package`);
    return { content: [{ type: "text", text: toText(data) }] };
  }
);

server.tool(
  "complete_migration_job",
  "Complete a manual job that requires user action. Used for jobs with type MANUAL_SYNC_LOVABLE, " +
  "MANUAL_SYNC_BASE44, MANUAL_EXPORT_DATA, MANUAL_IMPORT_DATA, etc. The job must be in READY status. " +
  "For MANUAL_SYNC_LOVABLE: ask the user to open their Lovable project and paste " +
  "'deploy staticbot edge function' into the Lovable AI chat. Once deployed, " +
  "use validate_function_url to verify, then call this tool with the functionUrl. " +
  "For MANUAL_SYNC_BASE44: ask the user to sync their Base44 project from GitHub, " +
  "then call this tool without a functionUrl. " +
  "Format: https://{projectRef}.supabase.co/functions/v1/{functionName}.",
  {
    jobId: z.string().uuid().describe("Migration job ID (from get_migration_jobs)"),
    functionUrl: z.string().optional().describe("Edge function URL (required for MANUAL_SYNC_LOVABLE; omit for MANUAL_SYNC_BASE44)"),
  },
  { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
  async ({ jobId, functionUrl }) => {
    const body = functionUrl ? { functionUrl } : {};
    const data = await apiFetch(`/api/v1/migrations/jobs/${jobId}/complete`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    return { content: [{ type: "text", text: toText(data) }] };
  }
);

server.tool(
  "choose_data_import_method",
  "Choose how to import data in Phase 3. Call this when a MANUAL_CHOOSE_DATA_IMPORT_METHOD job is READY. " +
  "IMPORTANT: You MUST present these options to the user and ask them to choose before calling this tool:\n" +
  "  1. 'automated' (recommended) — Staticbot deploys an edge function, exports data, imports to target, copies storage, migrates secrets/cron/auth. Fully automated.\n" +
  "  2. 'manual' — User exports data from Lovable and imports via Supabase SQL editor themselves.\n" +
  "Do NOT pick an option without asking the user first.",
  {
    migrationId: z.string().uuid().describe("Migration ID"),
    jobId: z.string().uuid().describe("The MANUAL_CHOOSE_DATA_IMPORT_METHOD job ID"),
    method: z.enum(["automated", "manual"]).describe("Import method"),
  },
  { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
  async ({ migrationId, jobId, method }) => {
    const data = await apiFetch(`/api/v1/migrations/${migrationId}/jobs/${jobId}/choose-method`, {
      method: "POST",
      body: JSON.stringify({ method }),
    });
    return { content: [{ type: "text", text: toText(data) }] };
  }
);

server.tool(
  "choose_backend_switchover",
  "Choose how to handle backend switchover in Phase 7. Call when MANUAL_CHOOSE_BACKEND_SWITCHOVER is READY. " +
  "IMPORTANT: You MUST present these options to the user and ask them to choose before calling this tool. " +
  "Four `choice` values are supported (use the literal string in your `choice` arg):\n" +
  "  1. 'switch-fully-to-supabase' (method='auto') — Staticbot opens a GitHub PR that replaces ALL Supabase env vars (URL, anon key) in the repo with the migrated target's values. After the PR is merged, BOTH the source platform's previews AND production use the new Supabase. This is the 'I'm leaving Lovable/Base44 for good' choice.\n" +
  "  2. 'source-preview-supabase-prod' (method='skip') — Production deployments read from the migrated Supabase backend; the source platform's preview environment keeps using its own managed Supabase as before. Good for gradual rollout where you keep developing in Lovable/Base44 but ship from the new Supabase. (Only shown to LOVABLE_SUPABASE and BASE44_SUPABASE customers — Bolt previews use WebContainer, not a separately-hosted Supabase.)\n" +
  "  3. 'source-primary-supabase-backup' (method='skip') — Nothing changes for now. The live app stays on the source platform's current setup; the migrated Supabase project is parked as a fallback the user can switch to later. (Same platform gating as #2.)\n" +
  "  4. 'handle-myself' (method='skip') — No automated changes. The user will update environment variables themselves whenever they're ready.\n\n" +
  "Historical aliases: the old `lovable-preview-supabase-prod` and `lovable-primary-supabase-backup` IDs are still accepted by the backend (it stores `choice` as an opaque label). Prefer the `source-*` names for new calls so analytics filters reflect the platform-agnostic semantic.\n\n" +
  "Platform-specific job creation under method='auto':\n" +
  "  • BASE44_SUPABASE — creates MANUAL_SWITCH_BASE44_SECRETS jobs (Base44 manages env vars on its platform, not in GitHub). The user updates secrets in Base44's UI.\n" +
  "  • BASE44_NATIVE — Phase 7 is fully automated (installs @bitfiction/base44-supabase-shim into the repo). No manual CHOOSE gate.\n" +
  "  • All other source types — rewrites env vars in the GitHub repo directly.\n" +
  "Do NOT pick an option without asking the user first.",
  {
    migrationId: z.string().uuid().describe("Migration ID"),
    jobId: z.string().uuid().describe("The MANUAL_CHOOSE_BACKEND_SWITCHOVER job ID"),
    method: z.enum(["auto", "skip"]).describe("Switchover method"),
    choice: z.string().optional().describe("Switchover strategy: 'switch-fully-to-supabase' | 'source-preview-supabase-prod' | 'source-primary-supabase-backup' | 'handle-myself' (or the deprecated `lovable-*` aliases for backward compat)"),
  },
  { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
  async ({ migrationId, jobId, method, choice }) => {
    const data = await apiFetch(`/api/v1/migrations/${migrationId}/jobs/${jobId}/choose-backend-switchover`, {
      method: "POST",
      body: JSON.stringify({ method, choice: choice ?? method }),
    });
    return { content: [{ type: "text", text: toText(data) }] };
  }
);

server.tool(
  "choose_frontend_deploy",
  "Choose how to handle frontend deployment in Phase 8 (Next Steps). Call when MANUAL_CHOOSE_FRONTEND_DEPLOY is READY. " +
  "IMPORTANT: You MUST present these options to the user and ask them to choose before calling this tool:\n" +
  "  1. 'continuous-sync' (method='continuous-sync', choice='setup-continuous-sync') — Sets up automatic GitHub-to-target sync. Every push to the repo automatically deploys to the new Supabase. Recommended for most users.\n" +
  "  2. 'staticbot' (method='staticbot', choice='deploy-with-staticbot') — Deploy the frontend with Staticbot. Staticbot analyzes the repository and selects the supported target and ownership model; do not promise AWS or Cloudflare before that analysis.\n" +
  "  3. 'skip' (method='skip') — Skip frontend deployment entirely.\n" +
  "Do NOT pick an option without asking the user first.",
  {
    migrationId: z.string().uuid().describe("Migration ID"),
    jobId: z.string().uuid().describe("The MANUAL_CHOOSE_FRONTEND_DEPLOY job ID"),
    method: z.enum(["continuous-sync", "staticbot", "skip"]).describe("Deploy method"),
    choice: z.string().optional().describe("Deploy strategy"),
  },
  { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
  async ({ migrationId, jobId, method, choice }) => {
    const data = await apiFetch(`/api/v1/migrations/${migrationId}/jobs/${jobId}/choose-frontend-deploy`, {
      method: "POST",
      body: JSON.stringify({ method, choice: choice ?? method }),
    });
    return { content: [{ type: "text", text: toText(data) }] };
  }
);

server.tool(
  "validate_function_url",
  "Validate that a Supabase edge function URL is reachable and responding. Use during Phase 3 " +
  "after the edge function has been deployed by the user pasting 'deploy staticbot edge function' " +
  "into the Lovable AI chat. " +
  "The function URL can be derived as https://{sourceProjectRef}.supabase.co/functions/v1/{functionName} " +
  "where functionName is in the MANUAL_SYNC_LOVABLE job's inputData. The validation updates the job's " +
  "stored verification state and returns {status: 'ok'|'error', message}. " +
  "Poll every 15-30 seconds if waiting for deployment.",
  {
    jobId: z.string().uuid().describe("The MANUAL_SYNC_LOVABLE job ID"),
    functionUrl: z.string().describe("Edge function URL to validate"),
  },
  { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  async ({ jobId, functionUrl }) => {
    const data = await apiFetch(`/api/v1/migrations/jobs/${jobId}/validate-function`, {
      method: "POST",
      body: JSON.stringify({ functionUrl }),
    });
    return { content: [{ type: "text", text: toText(data) }] };
  }
);

server.tool(
  "list_integration_instances",
  "List all connected integrations for the organization. Each instance has a 'type' field " +
  "identifying whether it is 'supabase', 'github', 'base44', etc. Use the instance with type='supabase' " +
  "as supabaseIntegrationInstanceId, type='github' as githubIntegrationInstanceId, and type='base44' " +
  "as sourceIntegrationInstanceId (for BASE44_NATIVE migrations) when calling create_migration.",
  {},
  { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  async () => {
    const data = await apiFetch("/api/v1/migrations/integrations/instances");
    return { content: [{ type: "text", text: toText(data) }] };
  }
);

server.tool(
  "list_supabase_projects",
  "List all Supabase projects accessible through a connected Supabase integration instance. " +
  "Returns project name, reference ID, region, and status. Use the project's id field as " +
  "targetSupabaseProjectRef when creating a migration. Only ACTIVE_HEALTHY projects can be " +
  "used as targets. IMPORTANT: Present the list to the user and ask them to choose which " +
  "project to use as the migration target.",
  {
    supabaseIntegrationInstanceId: z.string().uuid().describe("Supabase integration instance ID (from list_integration_instances)"),
  },
  { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  async ({ supabaseIntegrationInstanceId }) => {
    const data = await apiFetch(
      `/api/v1/migrations/integrations/instances/${supabaseIntegrationInstanceId}/supabase-projects`
    );
    return { content: [{ type: "text", text: toText(data) }] };
  }
);
}
