# Contributing to Staticbot MCP

This repository is the public, agent-facing adapter for the Staticbot API. Keep it thin: the backend owns workflow state and business logic; this package owns MCP tool names, input schemas, descriptions, and HTTP transport.

## Local verification

Use Node.js 20 or newer.

```sh
npm ci
npm test
npm pack --dry-run --json
```

`npm test` builds the package and starts a smoke-test MCP client that verifies the server can initialize and enumerate its tools. The pack dry run should contain only the files intended for npm distribution.

For local development:

```sh
npm run dev
```

The server uses hosted Staticbot by default. Set `STATICBOT_API_URL` only when intentionally testing against a self-hosted or local API.

## Architecture

`src/index.ts` registers each tool with `server.tool(name, description, schema, handler)`. Handlers are small wrappers around the Staticbot REST API, with `apiFetch` as the shared transport helper.

- Tool descriptions tell an MCP client when and why to select a tool.
- Zod field descriptions tell it how to construct valid inputs.
- Approval, review, retry, skip, and rollback requirements belong next to the affected tool.
- Business rules and pipeline sequencing belong in the Staticbot backend, not this package.

Never include API keys, source credentials, or other secrets in tool output or errors.

## Documentation boundaries

- `README.md` is for humans installing and evaluating the package.
- Tool and field descriptions are the runtime contract for MCP clients.
- `skills/staticbot/` is the public direct-API alternative for compatible agent environments.
- Public website documentation explains capabilities and user outcomes.
- Detailed pipeline design, release procedures, incident recovery, and operational tuning remain in Staticbot's private engineering documentation.

Do not add a hard-coded end-to-end pipeline guide here. Runtime clients should follow API state such as `pendingAction`, while maintainers document implementation details privately.

## Change checklist

1. Confirm the live API contract and current backend behavior.
2. Update the tool description and Zod schema together.
3. Preserve explicit confirmation for destructive or externally mutating actions.
4. Keep the MCP server version synchronized with `package.json`.
5. Run the local verification commands above.
6. Review the npm pack manifest before publishing.

Staticbot maintainers should also follow the private MCP release runbook before publishing.
