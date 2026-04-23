#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const API_URL = process.env.STATICBOT_API_URL ?? "http://localhost:9000";
const API_KEY = process.env.STATICBOT_API_KEY;

if (!API_KEY) {
  process.stderr.write("Error: STATICBOT_API_KEY environment variable is required\n");
  process.exit(1);
}

async function apiFetch(path: string, options: RequestInit = {}): Promise<unknown> {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Authorization": `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });

  const text = await res.text();

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}: ${text}`);
  }

  return text ? JSON.parse(text) : null;
}

function toText(data: unknown): string {
  return JSON.stringify(data, null, 2);
}

const server = new McpServer({
  name: "staticbot",
  version: "1.3.0",
});

// ─── Templates ───────────────────────────────────────────────────────────────

server.tool(
  "list_templates",
  "List available infrastructure templates. Templates define what gets deployed — e.g. a Vite app, a Supabase self-hosted stack, or a combined infra+website setup. Use this to find a template before creating a stack.",
  {},
  async () => {
    const data = await apiFetch("/api/v1/templates");
    return { content: [{ type: "text", text: toText(data) }] };
  }
);

server.tool(
  "get_template",
  "Get details of a template including its configuration variables. Use this to see what configOverrides are available when creating a stack. The configVariables field lists environment variables the template supports (e.g. VITE_SUPABASE_URL).",
  {
    id: z.string().uuid().describe("Template ID"),
  },
  async ({ id }) => {
    const data = await apiFetch(`/api/v1/templates/${id}`);
    return { content: [{ type: "text", text: toText(data) }] };
  }
);

// ─── Stacks ──────────────────────────────────────────────────────────────────

server.tool(
  "list_stacks",
  "List all infrastructure stacks. A stack groups one or more templates with a domain assignment. Each stack can have multiple deployments.",
  {},
  async () => {
    const data = await apiFetch("/api/v1/stacks");
    return { content: [{ type: "text", text: toText(data) }] };
  }
);

server.tool(
  "get_stack",
  "Get details of a stack including its templates and configuration.",
  {
    id: z.string().uuid().describe("Stack ID"),
  },
  async ({ id }) => {
    const data = await apiFetch(`/api/v1/stacks/${id}`);
    return { content: [{ type: "text", text: toText(data) }] };
  }
);

server.tool(
  "create_stack",
  "Create a new infrastructure stack from a template. A stack ties a template to a domain and becomes deployable. Call list_templates first to find the right templateId. Returns the stack ID and a statusUrl link to the Staticbot UI.",
  {
    name: z.string().describe("Human-readable name for the stack (e.g. 'My Portfolio Site')"),
    templateId: z.string().uuid().describe("Template ID — get this from list_templates"),
    configOverrides: z.record(z.string()).optional().describe(
      "Key/value overrides for template config variables (e.g. {\"VITE_SUPABASE_URL\": \"https://...\"}). See get_template for available keys."
    ),
    domainOption: z.discriminatedUnion("type", [
      z.object({
        type: z.literal("AUTO_GENERATED"),
      }).describe("Let Staticbot generate a subdomain automatically (fastest, good for testing)"),
      z.object({
        type: z.literal("CUSTOM_DOMAIN"),
        domainName: z.string().describe("Your custom domain (e.g. 'example.com')"),
      }).describe("Use your own domain — you'll need to set up DNS records later"),
      z.object({
        type: z.literal("EXISTING_DOMAIN"),
        dnsDomainId: z.string().uuid().describe("ID of a DNS domain already registered in Staticbot"),
      }).describe("Reuse a domain already managed in Staticbot"),
    ]).describe("How to assign a domain to this stack"),
  },
  async ({ name, templateId, configOverrides, domainOption }) => {
    const body = { name, templateId, configOverrides: configOverrides ?? {}, domainOption };
    const data = await apiFetch("/api/v1/stacks", {
      method: "POST",
      body: JSON.stringify(body),
    });
    return { content: [{ type: "text", text: toText(data) }] };
  }
);

// ─── Deployments ─────────────────────────────────────────────────────────────

server.tool(
  "list_deployments",
  "List all deployments. Optionally filter by stackId. Each deployment represents one execution of a stack's infrastructure.",
  {
    stackId: z.string().uuid().optional().describe("Filter deployments by stack ID"),
  },
  async ({ stackId }) => {
    const qs = stackId ? `?stackId=${encodeURIComponent(stackId)}` : "";
    const data = await apiFetch(`/api/v1/deployments${qs}`);
    return { content: [{ type: "text", text: toText(data) }] };
  }
);

server.tool(
  "create_deployment",
  "Create a new deployment for a stack. This prepares the deployment but does NOT start it — call start_deployment next. Default type is APPLY (creates real resources). Use PLAN for a dry-run preview.",
  {
    stackId: z.string().uuid().describe("Stack ID to deploy"),
    deploymentType: z.enum(["APPLY", "PLAN", "DRY_RUN"]).optional().describe(
      "APPLY creates real infrastructure (default). PLAN shows what would change without creating anything. DRY_RUN validates the template."
    ),
  },
  async ({ stackId, deploymentType }) => {
    const body = { stackId, deploymentType: deploymentType ?? "APPLY" };
    const data = await apiFetch("/api/v1/deployments", {
      method: "POST",
      body: JSON.stringify(body),
    });
    return { content: [{ type: "text", text: toText(data) }] };
  }
);

server.tool(
  "start_deployment",
  "Start a deployment that was created with create_deployment. The deployment must be in CREATED status. Once started, Staticbot provisions infrastructure in the target AWS account. Poll get_deployment to track progress.",
  {
    id: z.string().uuid().describe("Deployment ID"),
  },
  async ({ id }) => {
    const data = await apiFetch(`/api/v1/deployments/${id}/start`, { method: "POST" });
    return { content: [{ type: "text", text: toText(data) }] };
  }
);

server.tool(
  "get_deployment",
  "Get the status of a deployment. Use this to poll for progress. When status is WAITING, the response includes DNS records the user must configure. When status is COMPLETED, the site is live. Statuses: CREATED → PENDING → IN_PROGRESS → WAITING → COMPLETED (or FAILED).",
  {
    id: z.string().uuid().describe("Deployment ID"),
  },
  async ({ id }) => {
    const data = await apiFetch(`/api/v1/deployments/${id}`);
    return { content: [{ type: "text", text: toText(data) }] };
  }
);

// ─── Migrations ──────────────────────────────────────────────────────────────

server.tool(
  "list_migrations",
  "List all Supabase-to-self-hosted migrations. Optionally filter by status. Migrations orchestrate moving a full Supabase project (database, auth, storage, edge functions) to self-hosted infrastructure.",
  {
    status: z.string().optional().describe(
      "Filter by status: PENDING, IN_PROGRESS, PAUSED_FOR_APPROVAL, PAUSED_FOR_USER_ACTION, PAUSED_BY_USER, COMPLETED, COMPLETED_WITH_ERRORS, FAILED"
    ),
  },
  async ({ status }) => {
    const qs = status ? `?status=${encodeURIComponent(status)}` : "";
    const data = await apiFetch(`/api/v1/migrations${qs}`);
    return { content: [{ type: "text", text: toText(data) }] };
  }
);

server.tool(
  "get_migration",
  "Get the current status and phase breakdown of a migration. The response includes all 8 phases (Discovery, DB Migration, Data Import, Edge Functions, Storage, Auth Config, Backend Switchover, Frontend Deploy) with their individual statuses.",
  {
    id: z.string().uuid().describe("Migration ID"),
  },
  async ({ id }) => {
    const data = await apiFetch(`/api/v1/migrations/${id}`);
    return { content: [{ type: "text", text: toText(data) }] };
  }
);

server.tool(
  "confirm_migration",
  "Approve a migration that is PAUSED_FOR_APPROVAL. This happens after the Discovery phase completes — Staticbot has inventoried the source project and is waiting for the user to review before proceeding with the actual migration.",
  {
    id: z.string().uuid().describe("Migration ID"),
  },
  async ({ id }) => {
    const data = await apiFetch(`/api/v1/migrations/${id}/confirm`, { method: "POST" });
    return { content: [{ type: "text", text: toText(data) }] };
  }
);

server.tool(
  "resume_migration",
  "Resume a migration that is PAUSED_BY_USER or PAUSED_FOR_USER_ACTION. Use this after the user has completed the required manual step (e.g. DNS configuration, backend switchover review).",
  {
    id: z.string().uuid().describe("Migration ID"),
  },
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
  async ({ id }) => {
    const data = await apiFetch(`/api/v1/migrations/${id}/pause`, { method: "POST" });
    return { content: [{ type: "text", text: toText(data) }] };
  }
);

server.tool(
  "get_migration_jobs",
  "Get all jobs for a migration. Jobs are the individual work units within each phase (e.g. 'migrate_schema', 'import_data', 'deploy_edge_function_X'). Use this to understand what's happening at a granular level, diagnose failures, or find a jobId for retry/skip.",
  {
    id: z.string().uuid().describe("Migration ID"),
  },
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
  async ({ id }) => {
    const data = await apiFetch(`/api/v1/migrations/${id}/deployments`);
    return { content: [{ type: "text", text: toText(data) }] };
  }
);

server.tool(
  "create_migration",
  "Create a new Supabase-to-self-hosted migration. This starts the 8-phase pipeline: " +
  "Discovery → DB Migration → Data Import → Edge Functions → Storage → Auth Config → " +
  "Backend Switchover → Frontend Deploy. The migration starts in PENDING status with a " +
  "DISCOVERY job. After discovery completes, the migration pauses (PAUSED_FOR_APPROVAL) — " +
  "call confirm_migration to proceed. You need: sourceSupabaseUrl, sourceSupabaseAnonKey, " +
  "supabaseIntegrationInstanceId (from list_integration_instances), templateId (from list_templates), " +
  "and targetSupabaseProjectRef. Target keys are auto-fetched if not provided.",
  {
    name: z.string().describe("Human-readable name for this migration"),
    sourceSupabaseUrl: z.string().describe("Source Supabase project URL (e.g. https://abcdef.supabase.co)"),
    sourceSupabaseAnonKey: z.string().describe("Source Supabase anon key"),
    supabaseIntegrationInstanceId: z.string().uuid().describe("Supabase integration instance ID (from list_integration_instances)"),
    templateId: z.string().uuid().describe("Template ID for the target infrastructure (from list_templates)"),
    targetSupabaseProjectRef: z.string().describe("Target Supabase project reference (the subdomain part of the URL)"),
    targetSupabaseUrl: z.string().optional().describe("Target Supabase URL (auto-derived from projectRef if omitted)"),
    targetSupabaseAnonKey: z.string().optional().describe("Target anon key (auto-fetched from Supabase API if omitted)"),
    targetSupabaseServiceRoleKey: z.string().optional().describe("Target service role key (auto-fetched if omitted)"),
    githubIntegrationInstanceId: z.string().uuid().optional().describe("GitHub integration instance ID for repo access"),
    configOverrides: z.record(z.string()).optional().describe("Template config overrides"),
    githubRepoUrl: z.string().optional().describe("GitHub repo URL"),
    gitRepoAvailable: z.boolean().optional().describe("Whether the git repo is available"),
  },
  async (params) => {
    const data = await apiFetch("/api/v1/migrations", {
      method: "POST",
      body: JSON.stringify(params),
    });
    return { content: [{ type: "text", text: toText(data) }] };
  }
);

server.tool(
  "complete_migration_job",
  "Complete a manual job that requires user action. Used for jobs with type MANUAL_SYNC_LOVABLE, " +
  "MANUAL_EXPORT_DATA, MANUAL_IMPORT_DATA, etc. The job must be in READY status. " +
  "For MANUAL_SYNC_LOVABLE: pass functionUrl — this is the edge function URL that gets injected " +
  "into all downstream jobs. Format: https://{projectRef}.supabase.co/functions/v1/{functionName}. " +
  "Use validate_function_url first to verify the function is deployed.",
  {
    jobId: z.string().uuid().describe("Migration job ID (from get_migration_jobs)"),
    functionUrl: z.string().optional().describe("Edge function URL (required for MANUAL_SYNC_LOVABLE)"),
  },
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
  "'automated' (recommended): deploys an edge function, exports data, imports to target, copies storage, " +
  "migrates secrets/cron/auth. Creates an 8-job chain. " +
  "'manual': user exports from Lovable and imports via Supabase SQL editor.",
  {
    migrationId: z.string().uuid().describe("Migration ID"),
    jobId: z.string().uuid().describe("The MANUAL_CHOOSE_DATA_IMPORT_METHOD job ID"),
    method: z.enum(["automated", "manual"]).describe("Import method"),
  },
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
  "'auto' with choice 'switch-fully-to-supabase': replaces all Supabase env vars in the GitHub repo. " +
  "'auto' with choice 'lovable-preview-supabase-prod': Lovable keeps old Supabase, production uses new. " +
  "'skip': skip the switchover entirely.",
  {
    migrationId: z.string().uuid().describe("Migration ID"),
    jobId: z.string().uuid().describe("The MANUAL_CHOOSE_BACKEND_SWITCHOVER job ID"),
    method: z.enum(["auto", "skip"]).describe("Switchover method"),
    choice: z.string().optional().describe("Switchover strategy (e.g. 'switch-fully-to-supabase', 'lovable-preview-supabase-prod')"),
  },
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
  "'continuous-sync' with choice 'setup-continuous-sync': sets up automatic GitHub-to-target sync. " +
  "'staticbot' with choice 'deploy-with-staticbot': deploy frontend via Staticbot infrastructure. " +
  "'skip': skip frontend deployment.",
  {
    migrationId: z.string().uuid().describe("Migration ID"),
    jobId: z.string().uuid().describe("The MANUAL_CHOOSE_FRONTEND_DEPLOY job ID"),
    method: z.enum(["continuous-sync", "staticbot", "skip"]).describe("Deploy method"),
    choice: z.string().optional().describe("Deploy strategy"),
  },
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
  "after DEPLOY_EXPORT_FUNCTION completes to check if the function is deployed. The function URL " +
  "can be derived as https://{sourceProjectRef}.supabase.co/functions/v1/{functionName} where " +
  "functionName is in the MANUAL_SYNC_LOVABLE job's inputData. Returns {status: 'ok'|'error', message}. " +
  "Poll every 15-30 seconds if waiting for deployment.",
  {
    jobId: z.string().uuid().describe("The MANUAL_SYNC_LOVABLE job ID"),
    functionUrl: z.string().describe("Edge function URL to validate"),
  },
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
  "List all connected integrations (Supabase, GitHub, etc.) for the organization. " +
  "Use this to find the supabaseIntegrationInstanceId and githubIntegrationInstanceId " +
  "needed for create_migration.",
  {},
  async () => {
    const data = await apiFetch("/api/v1/migrations/integrations/instances");
    return { content: [{ type: "text", text: toText(data) }] };
  }
);

// ─── Lovable Sync Bridge (HTTP) ─────────────────────────────────────────────

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

interface SyncRequest {
  action: "SYNC_REQUEST";
  functionName: string;
  lovableProjectId: string;
  migrationId: string;
  jobId: string;
}

interface SyncResult {
  action: "SYNC_RESULT";
  status: "success" | "error";
  functionUrl?: string;
  message?: string;
}

let pendingSync: SyncRequest | null = null;
let syncResult: SyncResult | null = null;
let syncResultResolve: ((result: SyncResult) => void) | null = null;

const BRIDGE_PORT = 3847;

const bridgeServer = createServer((req: IncomingMessage, res: ServerResponse) => {
  // CORS headers for Chrome extension
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === "GET" && req.url === "/pending-sync") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(pendingSync));
    return;
  }

  if (req.method === "POST" && req.url === "/sync-result") {
    let body = "";
    req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
    req.on("end", () => {
      try {
        const result = JSON.parse(body) as SyncResult;
        syncResult = result;
        if (syncResultResolve) {
          syncResultResolve(result);
          syncResultResolve = null;
        }
        pendingSync = null;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok" }));
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "error", message: "Invalid JSON" }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

bridgeServer.listen(BRIDGE_PORT, "127.0.0.1", () => {
  process.stderr.write(`[staticbot-mcp] Lovable sync bridge listening on http://127.0.0.1:${BRIDGE_PORT}\n`);
});

// Ignore port-in-use errors (another MCP instance may be running)
bridgeServer.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    process.stderr.write(`[staticbot-mcp] Bridge port ${BRIDGE_PORT} already in use, skipping bridge server\n`);
  } else {
    process.stderr.write(`[staticbot-mcp] Bridge server error: ${err.message}\n`);
  }
});

function waitForSyncResult(timeoutMs: number): Promise<SyncResult> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      syncResultResolve = null;
      resolve({ action: "SYNC_RESULT", status: "error", message: "Lovable sync timed out after " + (timeoutMs / 1000) + "s. The function may still be deploying — try again or sync Lovable manually." });
    }, timeoutMs);

    syncResultResolve = (result) => {
      clearTimeout(timer);
      resolve(result);
    };

    // Check if result already arrived
    if (syncResult) {
      clearTimeout(timer);
      syncResultResolve = null;
      const result = syncResult;
      syncResult = null;
      resolve(result);
    }
  });
}

server.tool(
  "lovable_sync",
  "Trigger Lovable to deploy the staticbot edge function via the Chrome extension bridge. " +
  "The Chrome extension must be installed and a Staticbot or Lovable page must be open. " +
  "This tool sets a pending sync request that the Chrome extension picks up, then waits " +
  "for the result (up to 3 minutes). If the extension is not connected, falls back to " +
  "asking the user to manually sync. Use this after DEPLOY_EXPORT_FUNCTION completes and " +
  "MANUAL_SYNC_LOVABLE is READY.",
  {
    functionName: z.string().describe("Edge function name (e.g. staticbot-export-abc123)"),
    lovableProjectId: z.string().describe("Lovable project ID (UUID from the Lovable URL)"),
    migrationId: z.string().uuid().describe("Migration ID"),
    jobId: z.string().uuid().describe("The MANUAL_SYNC_LOVABLE job ID"),
  },
  async ({ functionName, lovableProjectId, migrationId, jobId }) => {
    // Clear any previous state
    syncResult = null;
    syncResultResolve = null;

    // Set the pending sync request for the Chrome extension to pick up
    pendingSync = {
      action: "SYNC_REQUEST",
      functionName,
      lovableProjectId,
      migrationId,
      jobId,
    };

    // Wait for result (3 minute timeout)
    const result = await waitForSyncResult(180_000);
    pendingSync = null;

    return { content: [{ type: "text", text: toText(result) }] };
  }
);

// ─── Connected Projects (Continuous Sync) ───────────────────────────────────

server.tool(
  "list_connected_projects",
  "List all connected projects. Connected projects sync changes from a GitHub repo to a target Supabase instance and optional AWS deployment. After a migration completes, enable continuous sync to keep the target up-to-date with Lovable.",
  {
    syncMode: z.string().optional().describe("Filter by sync mode: AUTOMATIC, MANUAL, PAUSED, ARCHIVED"),
  },
  async ({ syncMode }) => {
    const qs = syncMode ? `?syncMode=${encodeURIComponent(syncMode)}` : "";
    const data = await apiFetch(`/api/v1/connected-projects${qs}`);
    return { content: [{ type: "text", text: toText(data) }] };
  }
);

server.tool(
  "get_connected_project",
  "Get details of a connected project including sync mode, webhook status, linked migration, and deployment.",
  {
    id: z.string().uuid().describe("Connected project ID"),
  },
  async ({ id }) => {
    const data = await apiFetch(`/api/v1/connected-projects/${id}`);
    return { content: [{ type: "text", text: toText(data) }] };
  }
);

server.tool(
  "trigger_sync",
  "Trigger a manual sync for a connected project. Detects changes since the last sync (new database migrations, edge function updates, frontend changes) and applies them to the target Supabase instance and AWS deployment.",
  {
    id: z.string().uuid().describe("Connected project ID"),
    commitSha: z.string().optional().describe("Specific commit SHA to sync to (defaults to latest on branch)"),
  },
  async ({ id, commitSha }) => {
    const body = commitSha ? { commitSha } : {};
    const data = await apiFetch(`/api/v1/connected-projects/${id}/sync`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    return { content: [{ type: "text", text: toText(data) }] };
  }
);

server.tool(
  "list_sync_runs",
  "List sync run history for a connected project. Each sync run represents one execution of the sync pipeline — applying migrations, deploying edge functions, and rebuilding the frontend.",
  {
    id: z.string().uuid().describe("Connected project ID"),
  },
  async ({ id }) => {
    const data = await apiFetch(`/api/v1/connected-projects/${id}/sync-runs`);
    return { content: [{ type: "text", text: toText(data) }] };
  }
);

server.tool(
  "get_sync_run",
  "Get details of a specific sync run including status, commit SHA, summary of changes, and error message if failed. Statuses: PENDING → IN_PROGRESS → COMPLETED/FAILED. Destructive migrations cause PAUSED_FOR_REVIEW.",
  {
    projectId: z.string().uuid().describe("Connected project ID"),
    runId: z.string().uuid().describe("Sync run ID"),
  },
  async ({ projectId, runId }) => {
    const data = await apiFetch(`/api/v1/connected-projects/${projectId}/sync-runs/${runId}`);
    return { content: [{ type: "text", text: toText(data) }] };
  }
);

server.tool(
  "get_sync_run_jobs",
  "Get all jobs for a sync run. Jobs are the individual work units (e.g. apply_migration, deploy_edge_function, frontend_deploy). Use this to diagnose sync failures at the job level.",
  {
    projectId: z.string().uuid().describe("Connected project ID"),
    runId: z.string().uuid().describe("Sync run ID"),
  },
  async ({ projectId, runId }) => {
    const data = await apiFetch(`/api/v1/connected-projects/${projectId}/sync-runs/${runId}/jobs`);
    return { content: [{ type: "text", text: toText(data) }] };
  }
);

server.tool(
  "confirm_sync_run",
  "Confirm a sync run that is PAUSED_FOR_REVIEW. Destructive database migrations (DROP TABLE, ALTER COLUMN) pause the sync for review before applying. Optionally skip the destructive migrations instead of applying them.",
  {
    projectId: z.string().uuid().describe("Connected project ID"),
    runId: z.string().uuid().describe("Sync run ID"),
    skipDestructive: z.boolean().optional().describe("If true, skip destructive migrations instead of applying them"),
  },
  async ({ projectId, runId, skipDestructive }) => {
    const body = skipDestructive !== undefined ? { skipDestructive } : {};
    const data = await apiFetch(`/api/v1/connected-projects/${projectId}/sync-runs/${runId}/confirm`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    return { content: [{ type: "text", text: toText(data) }] };
  }
);

// ─── Start ───────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
