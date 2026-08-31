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

## `lovable_sync` is stdio-only, and must stay that way

`registerLovableSyncBridge` is deliberately not in `createServer`. The tool needs a Chrome extension
on the **user's own machine** to reach a bridge on `127.0.0.1:3847`, keeps the pending request in
module state, and blocks up to three minutes waiting for the extension.

Hosted, all three break: the server runs in Kubernetes where no browser extension can reach it,
module state is not shared between replicas, and every replica would try to bind the same port.
Registering it over HTTP would advertise a tool that can only ever time out. The hosted server
therefore exposes **49** tools, not 50 — that difference is intentional, not drift.

Calling `registerLovableSyncBridge` starts the listener as a side effect, so only the stdio
entrypoint may call it.

## Statelessness

Nothing here holds cross-request state, which is what makes a hosted transport viable at more than
one replica. Keep it that way: long-running work is modelled as **explicit handles** — migration and
deployment UUIDs returned by tools and passed back as arguments — which is exactly what the MCP
2026-07-28 guidance asks for, and what Staticbot's domain already produces naturally.

The pinned SDK (1.30.0, the latest published) supports protocol versions only up to `2025-11-25`, so
the new stateless protocol core cannot be adopted yet. Because the registry holds no state, adopting
it later is a transport swap rather than a rewrite.
