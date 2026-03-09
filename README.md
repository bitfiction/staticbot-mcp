# staticbot-mcp

MCP server for [Staticbot](https://www.staticbot.dev) — lets AI agents (Claude Code, Cursor, and any MCP-compatible runtime) orchestrate deployment workflows via the Staticbot API.

## What Staticbot does

Staticbot is a managed operations platform for complex, long-running deployment workflows. It hosts static websites and web apps inside **your own AWS account** using S3 and CloudFront — no vendor lock-in, no PaaS markup, full ownership of the infrastructure.

Core workflows:

- **Deploy to AWS** — Static websites and web apps to S3 + CloudFront CDN, with custom domains and automatic SSL via ACM
- **Supabase migration** — Orchestrates moving a full Supabase project (database, edge functions, storage, auth) to your own AWS infrastructure
- **Multi-stage deployments** — Dev, preview, and production stages per website with independent lifecycle management

Staticbot owns the things agents handle poorly: state that persists across sessions, credentials that should never appear in a context window, approval gates before destructive operations, and accumulated operational knowledge from real-world failure modes.

## Prerequisites

- A [Staticbot](https://www.staticbot.dev) account
- An API key — generate one at **Settings → API Keys** in the Staticbot UI
- Node.js 18+

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

### Migrations

| Tool | Description |
|---|---|
| `list_migrations` | List all migrations; optionally filter by status |
| `get_migration` | Get current status and phase breakdown of a migration |
| `confirm_migration` | Approve a migration paused for review after discovery |
| `resume_migration` | Resume a migration that was paused by the user or awaiting action |
| `get_migration_deployments` | List the AWS deployments associated with a migration |

Migration statuses: `PENDING` → `IN_PROGRESS` → `PAUSED_FOR_APPROVAL` → `IN_PROGRESS` → `COMPLETED` (or `COMPLETED_WITH_ERRORS` / `FAILED`). Migrations may also pause at `PAUSED_FOR_USER_ACTION` when a human step is required (e.g. DNS record setup).

### Deployments

| Tool | Description |
|---|---|
| `get_deployment` | Get deployment status; when status is `WAITING`, includes required DNS records to configure |

### Stacks

| Tool | Description |
|---|---|
| `create_stack` | Create an infrastructure stack from a template; supports auto-generated, custom, or existing domains |

## How agent-assisted deployment works

Tools return immediately with an ID and a `statusUrl` — a deep link into the Staticbot UI. The agent gives this to the human, then polls or waits.

```
Human: "Deploy my site to AWS on example.com"

Agent:
  1. Calls create_stack(...) → gets stack_id + status_url
  2. Tells human: "Deployment started. Track progress here: [status_url]"
  3. Polls get_deployment() until status changes
  4. When status = WAITING:
       Tells human: "DNS setup required. Add these records to your domain
       registrar, then come back and confirm. Details: [status_url]"
  5. Human configures DNS, confirms in Staticbot UI
  6. Agent resumes polling
  7. When status = COMPLETED:
       Tells human the live URL
```

For migrations:

```
Human: "Migrate my Lovable project to my own AWS"

Agent:
  1. Calls list_migrations() to check for existing work
  2. Starts migration → gets migration_id + status_url
  3. Shares status_url with human immediately
  4. When status = PAUSED_FOR_APPROVAL:
       "Discovery complete — Staticbot found 3 tables, 2 edge functions,
        1 storage bucket. Review the plan and approve at [status_url]"
  5. Human reviews and approves in the Staticbot UI
  6. Agent calls confirm_migration() or human approves in UI
  7. Polls to completion, reports live URL
```

The agent handles orchestration. Staticbot handles execution, state, credentials, and oversight. The human has a live view throughout.

## What Staticbot is not

- **Not a CI/CD platform** — it doesn't replace GitHub Actions or deployment pipelines
- **Not a no-code builder** — it deploys applications, it doesn't create them
- **Not a generic infrastructure tool** — use Terraform or Pulumi for arbitrary infra; Staticbot is for proven, opinionated playbooks

## License

MIT
