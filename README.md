# staticbot-mcp

MCP server for [Staticbot](https://www.staticbot.dev) — lets AI agents (Claude Code, Cursor, and any MCP-compatible runtime) orchestrate deployment and migration workflows via the Staticbot API.

## What Staticbot does

Staticbot is a managed operations platform for complex, long-running deployment workflows. It hosts static websites and web apps inside **your own AWS account** using S3 and CloudFront — no vendor lock-in, no PaaS markup, full ownership of the infrastructure.

Core workflows:

- **Deploy to AWS** — Static websites and web apps to S3 + CloudFront CDN, with custom domains and automatic SSL via ACM
- **Supabase migration** — Orchestrates moving a full Supabase project (database, edge functions, storage, auth) to self-hosted Supabase on your own AWS infrastructure
- **Multi-stage deployments** — Dev, preview, and production stages per website with independent lifecycle management

Staticbot owns the things agents handle poorly: state that persists across sessions, credentials that should never appear in a context window, approval gates before destructive operations, and accumulated operational knowledge from real-world failure modes.

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
| `get_deployment` | Get deployment status; includes DNS records when status is `WAITING` |

### Migrations

| Tool | Description |
|---|---|
| `list_migrations` | List all Supabase migrations; optionally filter by status |
| `get_migration` | Get migration status and phase breakdown |
| `confirm_migration` | Approve a migration after discovery completes |
| `resume_migration` | Resume a paused migration |
| `pause_migration` | Pause a running migration |
| `get_migration_jobs` | List all jobs within a migration (for troubleshooting) |
| `retry_migration_job` | Retry a failed migration job |
| `skip_migration_job` | Skip a non-critical job that's blocking progress |
| `get_migration_deployments` | List AWS deployments for a migration's infrastructure |

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
  6. Polls get_deployment() until status changes
  7. When WAITING → tells human: "Add these DNS records, then confirm"
  8. When COMPLETED → reports the live URL
```

### Migrate a Lovable/Supabase app to self-hosted

```
Human: "Migrate my Lovable project to my own AWS"

Agent:
  1. list_migrations() → checks for existing work
  2. Human creates migration in the UI (complex setup with OAuth)
  3. get_migration(id) → monitors progress
  4. When PAUSED_FOR_APPROVAL → "Discovery found 3 tables, 2 edge
     functions, 1 storage bucket. Approve to continue."
  5. confirm_migration(id)
  6. Polls to track 8-phase pipeline progress
  7. If a job fails → get_migration_jobs(id) to diagnose
     → retry_migration_job(jobId) or skip_migration_job(jobId)
  8. When COMPLETED → reports success and live URL
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

## How it works

Tools return immediately with an ID and a `statusUrl` — a deep link into the Staticbot UI where the human can monitor progress in real time. The agent orchestrates; Staticbot handles execution, state, credentials, and oversight.

Migration status flow:
```
PENDING → IN_PROGRESS → PAUSED_FOR_APPROVAL → IN_PROGRESS → COMPLETED
                                                  ↕
                                    PAUSED_FOR_USER_ACTION
                                    PAUSED_BY_USER
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
