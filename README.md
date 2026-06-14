# staticbot-mcp

MCP server for [Staticbot](https://www.staticbot.dev) — lets AI agents (Claude Code, Cursor, and any MCP-compatible runtime) orchestrate deployment and migration workflows via the Staticbot API.

## What Staticbot does

Staticbot is a managed operations platform for complex, long-running deployment workflows. It hosts static websites and web apps inside **your own AWS account** using S3 and CloudFront — no vendor lock-in, no PaaS markup, full ownership of the infrastructure.

Core workflows:

- **Deploy to AWS** — Static websites and web apps to S3 + CloudFront CDN, with custom domains and automatic SSL via ACM
- **Supabase migration** — Orchestrates moving a full Supabase project (database, edge functions, storage, auth) to self-hosted Supabase on your own AWS infrastructure
- **Multi-stage deployments** — Dev, preview, and production stages per website with independent lifecycle management

Staticbot owns the things agents handle poorly: state that persists across sessions, credentials that should never appear in a context window, approval gates before destructive operations, and accumulated operational knowledge from real-world failure modes.

## Key capabilities

### Source-specific migration adapters

Migrations are not one-size-fits-all. `create_migration` accepts a `sourceType` parameter that selects the right pipeline:

- **Lovable / Supabase** (`LOVABLE_SUPABASE`, default) — 8-phase pipeline: Discovery → DB Migration → Data Import → Edge Functions → Storage Buckets → Auth Config → Backend Switchover → Next Steps. Requires GitHub repo URL. Automated data export via edge function deployment.
- **Bolt / Supabase** (`BOLT_SUPABASE`) — Same pipeline tuned for Bolt.new-built apps on Supabase.
- **Firebase** (`FIREBASE`) — 5-phase pipeline: Discovery → Schema Design → Data Import → Auth Migration → Storage Migration. Requires Firebase service account JSON. Git repo is optional. AI-assisted schema design maps Firestore collections to Postgres tables.
- **Base44 / Supabase** (`BASE44_SUPABASE`) — Base44 apps backed by Supabase. Same 8-phase pipeline. Backend switchover updates Base44 platform secrets (not GitHub env vars). Use `parse_source_keys` or `scan_deployed_url` to extract source Supabase credentials.
- **Base44 Native** (`BASE44_NATIVE`) — Base44 apps using `@base44/sdk` against Base44's managed backend (no source Supabase). Requires a Base44 integration instance. Discovery hits Base44's REST API, DDL is synthesised from entity schemas, data is imported directly. Phase 7 installs the `@bitfiction/base44-supabase-shim` into the repo.

### Target delivery modes

`create_migration` also accepts a `targetType` parameter:

- **`SUPABASE_CLOUD`** (default) — Staticbot applies the migration end-to-end against a managed Supabase project you own. Requires `targetSupabaseProjectRef` plus the Supabase integration instance.
- **`SUPABASE_SELF_HOSTED`** — Staticbot runs discovery + data export, then produces a downloadable AES-256-encrypted zip that the user applies to their self-hosted Supabase (typically by running Claude Code against the unzipped folder and following the bundled `CLAUDE.md`). Once the `GENERATE_PACKAGE` job is complete, call `download_package` to obtain the presigned URL plus the extraction password.

### Discovery inventory & plan introspection

The Discovery phase inventories the source project before any changes are made. The agent can read the full inventory programmatically:

- `get_migration_jobs()` → find the DISCOVERY job → read its `outputData` for structured inventory: tables, edge functions, storage buckets, secrets, migration files, resolved commit SHA
- Migration pauses (`PAUSED_FOR_APPROVAL`) — the agent presents the inventory to the user and calls `confirm_migration` only after explicit approval
- Sync runs expose a `diffInventory` field with granular change detection: `new_migrations`, `changed_functions`, `frontend_changed`, `storage_changed`, `auth_changed`

### Safety & approval gates

- **Discovery approval** — migration pauses after discovery; agent must present inventory and get user consent before proceeding
- **Destructive SQL detection** — sync runs with destructive migrations (DROP TABLE, ALTER COLUMN) pause as `PAUSED_FOR_REVIEW`; agent must confirm or skip
- **Non-destructive syncs** auto-complete without approval
- **Best-effort jobs** (storage copy, secrets, cron, auth identities) never block the pipeline — they always succeed at the job level and report outcomes via result fields (`copy_result`, etc.)
- **Choice gates** (data import method, backend switchover, frontend deploy) require explicit user decision — tool descriptions enforce "MUST present options to user"

### Template versioning & reproducibility

- Templates are pinned to Git commit SHAs (`repoVersion`)
- Each sync creates a new template version when changes are detected
- Every sync run tracks `fromRepoVersion` → `toCommitSha` for reproducible diffs
- Stacks bind templates at specific versions; deployments use Terraform/OpenTofu and are re-runnable

## Prerequisites

- A [Staticbot](https://www.staticbot.dev) account
- An API key — generate one at **Developer → API Keys** in the Staticbot UI
- Node.js 18+

## API Reference

The full interactive API documentation is available at **Developer → API Reference** in the Staticbot UI. It's powered by Stoplight Elements and lets you browse all endpoints, see request/response schemas, and try requests directly from the browser.

## Setup

### Claude Code

Add to your project's `.mcp.json` or global MCP config:

```json
{
  "mcpServers": {
    "staticbot": {
      "command": "npx",
      "args": ["-y", "staticbot-mcp"],
      "env": {
        "STATICBOT_API_KEY": "sk-your-api-key-here"
      }
    }
  }
}
```

### Cursor / other MCP clients

Point your MCP client at:

```
command: npx -y staticbot-mcp
env: STATICBOT_API_KEY=sk-your-api-key-here
```

### Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `STATICBOT_API_KEY` | Yes | — | API key from Staticbot Settings → API Keys |
| `STATICBOT_API_URL` | No | `http://localhost:9000` | Override for self-hosted instances |

## Available tools

### Templates

| Tool | Description |
|---|---|
| `list_templates` | List available infrastructure templates (Vite apps, Supabase stacks, etc.) |
| `get_template` | Get template details including configuration variables |
| `create_template` | Create a new template by scanning a GitHub repo (auto-detects platforms, env vars, builders) |
| `scan_deployed_url` | Scan a deployed Base44 app URL for inlined Supabase credentials (extracts from JS bundle) |

### Stacks

| Tool | Description |
|---|---|
| `list_stacks` | List all infrastructure stacks |
| `get_stack` | Get stack details including templates and configuration |
| `create_stack` | Create a stack from a template with domain assignment |

### Deployments

| Tool | Description |
|---|---|
| `list_deployments` | List deployments, optionally filtered by stack |
| `create_deployment` | Create a deployment for a stack (does not start it) |
| `start_deployment` | Start a created deployment — provisions infrastructure in AWS |
| `get_deployment` | Get deployment status + per-domain DNS state (`dns` array — read on every poll). See "Agent guidance: handling DNS" below |

### Migrations

| Tool | Description |
|---|---|
| `create_migration` | Create and start a new migration pipeline (`sourceType`: Lovable/Bolt/Firebase/Base44; `targetType`: managed cloud or downloadable self-hosted package) |
| `download_package` | Fetch the presigned URL + AES-256 password for a migration's downloadable zip (self-hosted delivery, or portable backup for cloud migrations) |
| `list_migrations` | List all migrations; optionally filter by status |
| `get_migration` | Get migration status and phase breakdown |
| `get_migration_jobs` | List all jobs with dependencies, input/output data, and results |
| `confirm_migration` | Approve a migration after discovery completes (requires user consent) |
| `resume_migration` | Resume a paused migration |
| `pause_migration` | Pause a running migration |
| `retry_migration_job` | Retry a failed migration job |
| `skip_migration_job` | Skip a non-critical job that's blocking progress |
| `complete_migration_job` | Complete a manual job (e.g. MANUAL_SYNC_LOVABLE, MANUAL_SYNC_BASE44) with required data |
| `get_migration_deployments` | List AWS deployments for a migration's infrastructure |
| `choose_data_import_method` | Phase 3: choose automated (edge function) or manual data import |
| `rechoose_data_import_method` | Reset Phase 3 choice to switch between automated and manual |
| `choose_backend_switchover` | Phase 7: switch env vars fully, split preview/prod, or skip (Base44: updates platform secrets) |
| `choose_frontend_deploy` | Phase 8: set up continuous sync, deploy via Staticbot, or skip |
| `validate_function_url` | Verify an edge function URL is deployed and responding |

### Integration utilities

| Tool | Description |
|---|---|
| `list_integration_instances` | List connected integrations (Supabase, GitHub, Base44, etc.) for the organization |
| `parse_source_keys` | Auto-extract source Supabase URL and anon key from a GitHub repo's `.env` file |
| `list_supabase_projects` | List all Supabase projects accessible through a connected integration |

### Lovable sync

| Tool | Description |
|---|---|
| `lovable_sync` | Trigger Lovable deployment via Chrome extension bridge (3 min timeout, fallback to manual) |

### Connected Projects (Continuous Sync)

| Tool | Description |
|---|---|
| `list_connected_projects` | List all connected projects; filter by sync mode (AUTOMATIC, MANUAL, PAUSED, ARCHIVED) |
| `get_connected_project` | Get project details: sync mode, webhook status, linked migration and deployment |
| `trigger_sync` | Trigger a manual sync — detects and applies changes since last sync |
| `list_sync_runs` | List sync run history (most recent first) |
| `get_sync_run` | Get sync run status, diff inventory, summary, and AI-generated description |
| `get_sync_run_jobs` | Get individual sync jobs (apply_migration, deploy_edge_function, frontend_deploy) |
| `confirm_sync_run` | Approve a sync paused for review (destructive migrations); optionally skip destructive ops |

## Typical workflows

### Deploy a website to AWS

```
Human: "Deploy my Vite app to AWS on example.com"

Agent:
  1. list_templates() → finds the Vite template
  2. create_stack(name, templateId, domain: "example.com")
  3. create_deployment(stackId) → gets deployment_id
  4. start_deployment(deployment_id)
  5. Shares statusUrl with human: "Deployment started — track it here"
  6. Polls get_deployment() until `dns` is non-empty or status changes
  7. Reads `dns[].action` and presents records to the human (see "Agent guidance: handling DNS" below)
  8. When COMPLETED and the human has added the records → reports the live URL
```

### Migrate a Lovable/Supabase app to self-hosted

```
Human: "Migrate my Lovable project to my own Supabase"

Agent:
  1. list_integration_instances() → find supabase + github instances
  2. parse_source_keys(githubRepoUrl) → auto-extract source URL and anon key
  3. list_supabase_projects(instanceId) → "Which project is the target?"
  4. list_templates() or create_template(repoLink) → get templateId
  5. create_migration(name, sourceUrl, anonKey, templateId, targetRef, ...)
  6. Poll get_migration(id) until PAUSED_FOR_APPROVAL
  7. get_migration_jobs(id) → read DISCOVERY job outputData
     → "Found 3 tables, 2 edge functions, 1 storage bucket. Proceed?"
  8. confirm_migration(id)
  9. Monitor phases — choose_data_import_method, handle lovable_sync,
     choose_backend_switchover, choose_frontend_deploy
 10. If a job fails → retry_migration_job or skip_migration_job
 11. When COMPLETED → reports success
```

### Keep a project in sync after migration

```
Human: "Sync my Lovable project with the new Supabase"

Agent:
  1. list_connected_projects() → find the project
  2. get_connected_project(id) → check sync mode and webhook status
  3. trigger_sync(id) → start sync
  4. list_sync_runs(id) → get latest run ID
  5. get_sync_run(projectId, runId) → check diffInventory and status
  6. If PAUSED_FOR_REVIEW → "Destructive migration detected. Apply or skip?"
     → confirm_sync_run(projectId, runId, skipDestructive)
  7. get_sync_run_jobs(projectId, runId) → verify all jobs completed
  8. When COMPLETED → report changes applied
```

### Browse and inspect infrastructure

```
Human: "What templates do we have available?"

Agent:
  1. list_templates() → shows all available templates
  2. get_template(id) → shows config variables for a specific one
  3. list_stacks() → shows what's already set up
  4. list_deployments(stackId) → shows deployment history
```

## Agent guidance: handling DNS

When you call `get_deployment`, the response includes a `dns` array — one entry per domain bound to the stack. Read this on every poll, not just on `WAITING`. Each entry has an `action` you should map to user-facing behavior:

| `action` | What it means | Agent behavior |
|---|---|---|
| `NO_ACTION` | The registrar's live NS records already overlap a Route53 zone Staticbot provisioned for this domain. DNS is correctly delegated. | Celebrate. No records to surface. |
| `MANUAL_RECORDS_AT_REGISTRAR` | Default for any domain we don't already manage. The user adds records at whatever DNS provider currently serves their domain. | Present `records` verbatim. Tell the user *where* to add them: their existing DNS provider, **not** Staticbot. Do **not** suggest changing nameservers. |
| `OFFER_CLOUDFLARE_PUSH` | Domain is on Cloudflare and a Cloudflare integration is linked in Staticbot. | Tell the user about the push-records button in the Staticbot UI (link via `statusUrl`). You can keep showing `records` as a fallback. |
| `OFFER_CLOUDFLARE_CONNECT` | Domain is on Cloudflare but no integration linked. | Suggest connecting Cloudflare for the smoothest no-NS-change path; show the manual `records` as the fallback. |
| `REGISTER_DOMAIN_FIRST` | RDAP says the domain isn't registered. | Block. Ask the user to register the domain before continuing. |

**Critical rules:**

- **Never recommend an NS-delegation change as the default.** Even when it would technically work, customers with live mail or other services routinely lose them when nameservers move. Staticbot's UI exposes NS-takeover only as an "Advanced" toggle behind a disclosure — agents should mirror that posture.
- **Treat `mailRecordsDetected: true` as a hard block on any NS-change advice.** This signals MX/TXT/SRV/CAA records exist on the apex. The recommendation engine already suppresses NS-takeover alternatives in this case; surface it to the user as "you have mail records, so we're keeping DNS where it is".
- **Use `staticbotManaged: true` to explain the happy path.** When the user asks "is my domain set up?", a `true` here means yes — live NS resolve to one of our zones.
- **Read `nsPointedAt` for context, not action.** It's `AWS_ROUTE53` | `CLOUDFLARE` | `OTHER`. Use it to phrase things ("your domain is hosted at Cloudflare today"), not to choose an action.
- **`records` is empty when `action ∈ {NO_ACTION, REGISTER_DOMAIN_FIRST, OFFER_CLOUDFLARE_CONNECT}`.** Don't synthesize records yourself; if `records` is empty, there's nothing to add.

**Example agent dialog (manual-records path):**

> Your deployment is up. To finish, add these records at your current DNS provider — that's where your domain is hosted today:
>
> - **CNAME** `_acme-challenge.example.com` → `_a1b2.acm-validations.aws.` (SSL certificate validation)
> - **ALIAS or ANAME** `@` → `d111.cloudfront.net.` (root domain)
> - **CNAME** `www` → `d111.cloudfront.net.` (www subdomain)
>
> I noticed you have email running on this domain (MX records detected), so I'm keeping the rest of your DNS where it is.

## How it works

Tools return immediately with an ID and a `statusUrl` — a deep link into the Staticbot UI where the human can monitor progress in real time. The agent orchestrates; Staticbot handles execution, state, credentials, and oversight.

Migration status flow:
```
PENDING → IN_PROGRESS → PAUSED_FOR_APPROVAL → IN_PROGRESS → COMPLETED
                                                    ↕         COMPLETED_WITH_ERRORS
                                      PAUSED_FOR_USER_ACTION
                                      PAUSED_BY_USER
                                                    ↓
                                                  FAILED
```

Sync run status flow:
```
PENDING → IN_PROGRESS → COMPLETED
                ↕          FAILED
        PAUSED_FOR_REVIEW
```

Deployment status flow:
```
CREATED → PENDING → IN_PROGRESS → WAITING → COMPLETED
                                     ↕
                                   FAILED
```

## What Staticbot is not

- **Not a CI/CD platform** — it doesn't replace GitHub Actions or deployment pipelines
- **Not a no-code builder** — it deploys applications, it doesn't create them
- **Not a generic infrastructure tool** — use Terraform or Pulumi for arbitrary infra; Staticbot is for proven, opinionated playbooks

## License

MIT
