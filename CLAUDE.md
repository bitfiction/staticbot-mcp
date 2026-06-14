# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

`staticbot-mcp` is the Model Context Protocol server for the Staticbot API. It exposes Staticbot's deployment and migration workflows as MCP tools so AI agents (Claude Code, Cursor, any MCP-compatible runtime) can orchestrate end-to-end migrations and deployments.

Distributed as an npm package with a `bin` entry — runs as a stdio MCP server under the host agent.

## Commands

```bash
npm run build    # tsc → dist/
npm run dev      # tsx src/index.ts (live)
npm run start    # node dist/index.js
```

Environment:

- `STATICBOT_API_KEY` (required) — bearer token for the Staticbot API
- `STATICBOT_API_URL` (optional, default `http://localhost:9000`) — API base URL

## Architecture

Single-file server: `src/index.ts`. Each tool is registered via `server.tool(name, description, schema, handler)` against `@modelcontextprotocol/sdk`. Tools are thin wrappers around HTTP calls to the Staticbot REST API; `apiFetch` is the only HTTP helper.

Tool categories (defined in order in `src/index.ts`):

- **Templates** — `list_templates`, `get_template`, `create_template`, `scan_deployed_url` (Base44 JS bundle scanner)
- **Stacks** — group templates into deployable units
- **Deployments** — `create_deployment`, `start_deployment`, status queries
- **Migrations** — full pipeline for Lovable, Bolt, Firebase, Base44 Supabase, and Base44 Native sources with discovery, approval gates, choice gates (data import method, backend switchover, frontend deploy), job management, package generation
- **Integrations** — list configured org integrations (Supabase, GitHub, Base44, etc.)
- **Lovable sync bridge** — local HTTP bridge on port 3847 for Chrome extension communication
- **Connected Projects** — incremental continuous sync after the initial migration

## Conventions

- **Tool descriptions matter**: agents pick tools by description. Keep them concrete and include guidance about when to ask the user vs. when to proceed automatically. Approval-gate tools should say "MUST present options to user".
- **Zod schemas**: every tool input is a Zod schema. Keep field descriptions human-readable — they show up in agent prompts.
- **Don't leak secrets**: `STATICBOT_API_KEY` must never be echoed in tool responses or error messages.
- **API is authoritative**: this package contains no business logic — if behavior needs to change, change it in `staticbot-app` and update the tool description here to match.
- **Versioning**: bump `package.json` version on every release. The MCP `name`/`version` reported to the host should match the npm version.

## How This Fits the Platform

The MCP server is the agent-facing surface of Staticbot. The Staticbot backend (`staticbot-app`) owns state and credentials; this package is intentionally stateless and delegates everything to API calls. See `MIGRATION_GUIDE.md` for the user-facing setup.
