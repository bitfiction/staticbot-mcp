# Hosted MCP transport

`POST /mcp` over Streamable HTTP with OAuth, sharing `createServer()` with the stdio entrypoint.
Entrypoint: `src/hosted/index.ts` (`staticbot-mcp-http`).

## Two identities, never one

| | |
|---|---|
| Caller | the end user, proving identity with an OAuth token whose `aud` is the MCP resource |
| Upstream | Staticbot, called as `staticbot_mcp_service` with the actor asserted in headers |

The user's token is verified here and **stops here**. Staticbot is called with a separate
service-account token plus `X-Staticbot-Actor-*`. Forwarding the user's token instead would be OAuth
token passthrough: it carries the wrong audience, and it would let anything holding it act as that
user against an API that never authenticated them.

**The audience check is the load-bearing line.** `createTokenVerifier` requires `aud` to equal the
canonical MCP resource exactly. Verified against the live realm: a valid, signed, unexpired Keycloak
token issued for `staticbot-internal-api` is rejected here, which is the confused-deputy protection
working.

## Stateless, and it must stay that way

A fresh `McpServer` and transport are built **per request** (`sessionIdGenerator: undefined`) and
closed when the response ends. Nothing is retained between requests, so any replica can answer any
request without shared storage or sticky routing.

Long-running work is represented by handles the client passes back — migration and deployment IDs —
never by state parked here. That is what the MCP 2026-07-28 guidance asks for, and Staticbot's domain
produces those handles naturally. Never hold a request open waiting for a migration gate: those run
for hours or days.

The pinned SDK (1.30.0, the latest published) speaks protocol versions only up to `2025-11-25`, so
the new stateless protocol core cannot be adopted yet. Because nothing here holds state, adopting it
later is a transport swap rather than a rewrite.

## Discovery

`GET /.well-known/oauth-protected-resource` returns the resource, the authorization server, and the
supported scopes. A 401 carries `WWW-Authenticate: Bearer resource_metadata="…"` pointing at it —
without that hint the client has a 401 and nowhere to go, and the connect flow stalls before it
starts.

## Gotchas

- **`/healthz` and `/readyz` do not touch Keycloak or Staticbot.** A probe that fails when a
  dependency is down converts their outage into a restart loop and makes recovery slower.
- **Service tokens are cached with a 30s margin and concurrent refreshes are collapsed.** Without
  that, every in-flight request mints its own token on expiry and Keycloak sees a burst of grants.
- **Staticbot's 403 bodies are surfaced verbatim.** They name the cause — "Delegated scope
  'staticbot:write' required", "Unknown Staticbot account for the asserted actor" — which a model can
  act on, where a bare status code just produces a retry loop.
- **`consentRequired: true` on `staticbot-openai` blocks the password grant**, so end-to-end testing
  needs the browser flow or a temporary change to that client. Verified by doing exactly that, then
  restoring both `consentRequired` and `directAccessGrantsEnabled`.

## Verified end to end (2026-08-31, local dev)

Real user token (`aud` = MCP resource, `scope` = `staticbot:read`) → `tools/list` returned 49 tools →
`tools/call list_templates` reached Staticbot, which just-in-time provisioned the user and their
organization, and returned template data.
