# Staticbot MCP server

Give Codex, Claude, Cursor, and other MCP-compatible agents safe access to [Staticbot](https://www.staticbot.dev). The server exposes typed tools for deploying websites, migrating application backends, and operating continuous sync while Staticbot keeps credentials and long-running workflow state outside the model context.

## Two ways to connect

**Connect the hosted server** — no install, no API key. Point an MCP client that supports remote
servers with OAuth at:

```text
https://mcp.staticbot.dev/mcp
```

You sign in to Staticbot, choose what to grant, and the client stores the connection. If you do not
have a Staticbot account yet, one is created when you first connect.

**Run it locally** — for clients that launch MCP servers as a local process. Needs Node.js 20 or
newer and a Staticbot API key from
[app.staticbot.dev/developer](https://app.staticbot.dev/developer).

Both expose the same tools. The hosted server acts as the person who authorized it and never sees an
API key; the local server uses the API key you give it.

## Install as a Codex plugin

This repository is also a Codex plugin. Its manifest bundles the Staticbot MCP server with three intent-focused skills:

- `deploy-web-app-with-staticbot` deploys a repository without making the agent choose a cloud provider. Staticbot analyzes the repo, classifies the workload, and selects the supported AWS or Cloudflare target plus its customer-owned or Staticbot-managed ownership model.
- `migrate-vibe-coded-app` moves Base44, Lovable, Bolt, or Firebase backends to customer-owned Supabase infrastructure with discovery and approval gates.
- `sync-vibe-coded-app` keeps migrated projects synchronized while preserving destructive-change review.

The general `staticbot` skill remains available as a direct REST API fallback.

## Install as a Claude Code plugin

Claude Code does not require Staticbot to be accepted into a central plugin registry. Add the self-hosted marketplace directly from this GitHub repository, then install the plugin:

```text
/plugin marketplace add bitfiction/staticbot-mcp
/plugin install staticbot@staticbot
```

Set `STATICBOT_API_KEY` in the environment that launches Claude Code. The plugin starts the published `@staticbot/mcp` package with `npx` and inherits that environment; `STATICBOT_API_URL` remains optional for self-hosted or local Staticbot APIs.

The installed skills are namespaced by the plugin. For example, use `/staticbot:deploy-web-app-with-staticbot`, `/staticbot:migrate-vibe-coded-app`, or `/staticbot:sync-vibe-coded-app`. Restart Claude Code or run `/reload-plugins` after installation if the plugin is not immediately available.

## Configure your MCP client directly

### Hosted (OAuth)

For clients that support remote MCP servers, add `https://mcp.staticbot.dev/mcp` and authorize when
prompted. The client discovers where to sign in from the server itself; there is nothing to copy or
paste, and no credential is stored on your machine.

### Local (API key)

Add the published package to your project or global MCP configuration:

```json
{
  "mcpServers": {
    "staticbot": {
      "command": "npx",
      "args": ["-y", "@staticbot/mcp"],
      "env": {
        "STATICBOT_API_KEY": "sk-your-api-key-here"
      }
    }
  }
}
```

Hosted Staticbot at `https://app.staticbot.dev` is the default. Do not set `STATICBOT_API_URL` for the hosted service; override it only when using a self-hosted or local Staticbot API.

Keep the API key in your MCP client's secret or environment configuration. Do not paste it into chat or commit it to a repository.

## What agents can do

The server groups its tools around user outcomes:

- Inspect templates, stacks, deployments, and integration connections
- Create and monitor static-site and SSR deployments
- Inspect deployment DNS, safely push deployment-owned records to linked Cloudflare zones, and recheck custom-hostname verification
- Migrate Lovable, Bolt, Firebase, and Base44 projects to Supabase targets
- Inspect migration discovery results and guide users through approval and choice gates
- Create previews and download portable migration packages
- Trigger, review, retry, or skip continuous-sync runs
- Roll back or redeploy a website using valid pinned versions returned by Staticbot

The tool schemas and descriptions are the runtime contract seen by MCP clients. They contain the operational instructions an agent needs at the moment it selects a tool.

## Example requests

- “Deploy this repository with Staticbot and tell me what DNS records I need.”
- “Push this deployment's required records to my linked Cloudflare zone, then recheck verification.”
- “Migrate my Base44 app to my Supabase project. Stop for approval before making changes.”
- “Show me what changed in the latest sync run and explain any destructive SQL.”
- “List valid rollback versions for this deployment, but do not roll back yet.”

## Safety contract

Staticbot tools are designed around explicit human control:

- Discovery results are presented before a migration is confirmed.
- Choice gates are shown to the user instead of being silently defaulted.
- Destructive sync changes pause for review.
- Failed work is explained before an agent retries or skips it.
- Rollbacks use an exact version returned by `list_rollback_versions` and require confirmation.
- Long-running operations return durable state that can be resumed across agent sessions.
- The hosted server acts strictly as the person who authorized it, within the permissions they
  granted, and can reach nothing outside their own organization.

When a migration response contains `pendingAction`, the client should treat it as the source of truth for the next step. Clients should not hard-code Staticbot's internal pipeline phases.

## Staticbot skills

The repository includes focused deployment, migration, and Continuous Sync skills plus a [general Staticbot Skill](https://github.com/bitfiction/staticbot-mcp/tree/main/skills/staticbot) for Codex or Claude environments that can operate the REST API directly without an MCP server. The direct-API workflow fetches the live OpenAPI contract and applies the same approval and credential-handling rules.

Use the MCP package when your client supports MCP. Use the Skill when direct API access from a command-line agent is more appropriate.

## Environment variables

These apply to the local server. The hosted server needs none of them.

| Variable | Required | Default | Purpose |
|---|---:|---|---|
| `STATICBOT_API_KEY` | Yes | — | Authenticates requests to Staticbot |
| `STATICBOT_API_URL` | No | `https://app.staticbot.dev` | Override only for a self-hosted or local API |

## Documentation

- [Staticbot website](https://www.staticbot.dev)
- [Interactive API reference and API keys](https://app.staticbot.dev/developer)
- [npm package](https://www.npmjs.com/package/@staticbot/mcp)
- [Contributing and local verification](https://github.com/bitfiction/staticbot-mcp/blob/main/CONTRIBUTING.md)

## License

MIT
