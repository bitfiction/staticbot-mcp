# Staticbot MCP server

Give Codex, Claude, Cursor, and other MCP-compatible agents safe access to [Staticbot](https://www.staticbot.dev). The server exposes typed tools for deploying websites, migrating application backends, and operating continuous sync while Staticbot keeps credentials and long-running workflow state outside the model context.

## Prerequisites

- A Staticbot account
- A Staticbot API key from [app.staticbot.dev/developer](https://app.staticbot.dev/developer)
- Node.js 20 or newer

## Configure your MCP client

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
- Migrate Lovable, Bolt, Firebase, and Base44 projects to Supabase targets
- Inspect migration discovery results and guide users through approval and choice gates
- Create previews and download portable migration packages
- Trigger, review, retry, or skip continuous-sync runs
- Roll back or redeploy a website using valid pinned versions returned by Staticbot

The tool schemas and descriptions are the runtime contract seen by MCP clients. They contain the operational instructions an agent needs at the moment it selects a tool.

## Example requests

- “Deploy this repository with Staticbot and tell me what DNS records I need.”
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

When a migration response contains `pendingAction`, the client should treat it as the source of truth for the next step. Clients should not hard-code Staticbot's internal pipeline phases.

## Staticbot Skill

The repository also includes a [Staticbot Skill](https://github.com/bitfiction/staticbot-mcp/tree/main/skills/staticbot) for Codex or Claude environments that can operate the REST API directly without an MCP server. It fetches the live OpenAPI contract and applies the same approval and credential-handling rules.

Use the MCP package when your client supports MCP. Use the Skill when direct API access from a command-line agent is more appropriate.

## Environment variables

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
