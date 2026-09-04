# Tool registry and the transport seam

`createServer(context)` builds the `McpServer` with all shared tools. `src/index.ts` is the stdio
entrypoint; a hosted HTTP entrypoint will call the same factory.

## Why the registry is separate from the transport

With a copy per transport, stdio and hosted drift into subtly different tool sets, and the divergence
surfaces as a customer reporting that a tool behaves differently in ChatGPT than in Claude Code. One
definition, two entrypoints.

## The seam is `ToolContext`, not a global API key

The original server closed over a module-level `API_KEY`, which works only because a stdio process
serves exactly one user. A hosted server has no ambient credential: every request carries its own
user, so `apiFetch` must be built **per request** from the caller's validated identity. `ToolContext`
is that indirection, and it is the reason tool bodies needed no edits during the split.

Anything that varies by caller belongs in `ToolContext`. Reaching for a module-level constant inside
a tool is the mistake this shape exists to prevent — it will work in stdio and leak across users when
hosted.

## Every tool is transport-agnostic

There is no stdio-only carve-out, and adding one should be resisted. A `lovable_sync` tool used to
drive a Chrome extension over a bridge on `127.0.0.1:3847`, holding the pending request in module
state and blocking for three minutes — none of which survives a hosted deployment. It was removed
rather than special-cased: the extension was never approved, and the orchestration it attempted now
happens client-side, where an agent runs Lovable's own MCP alongside Staticbot's. Staticbot does not
call Lovable's MCP itself.

The manual path it fell back to is the only path now, and it is the one the pipeline already
describes: the user pastes "deploy staticbot edge function" into the Lovable AI chat.

## Structured results

Every API-backed tool is registered through `registerApiTool`. Its descriptor declares the shared
`outputSchema`, and its result keeps the original JSON text for older clients while also returning
the parsed public-API response as `structuredContent.result`. The wrapper is deliberate: some API
endpoints return objects, others return arrays or empty results, while MCP structured content must
always have an object at the top level.

Keep response DTO details in the public API and its OpenAPI annotations. Duplicating those evolving
DTOs across all MCP tool files would create a second, stale contract; the MCP layer promises the
stable `{ result: JSONValue }` envelope and each tool description documents the fields agents need.

## Statelessness

Nothing here holds cross-request state, which is what makes a hosted transport viable at more than
one replica. Keep it that way: long-running work is modelled as **explicit handles** — migration and
deployment UUIDs returned by tools and passed back as arguments — which is exactly what the MCP
2026-07-28 guidance asks for, and what Staticbot's domain already produces naturally.

The pinned SDK (1.30.0, the latest published) supports protocol versions only up to `2025-11-25`, so
the new stateless protocol core cannot be adopted yet. Because the registry holds no state, adopting
it later is a transport swap rather than a rewrite.
