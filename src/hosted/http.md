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

## `KEYCLOAK_ISSUER` vs `KEYCLOAK_JWKS_URL`

In production they are the same host and the JWKS URL should be left unset. They come apart in local
development: a token minted through the browser carries `iss: http://localhost:9080/...`, so the
issuer must be exactly that or validation fails — but a container cannot reach the host's localhost,
so the keys must be fetched over the compose network. Validation identity and network route are
different concerns, and `KEYCLOAK_JWKS_URL` exists to separate them.

`docker compose --profile mcp up mcp` sets both accordingly. The service is profile-gated because it
needs the `staticbot_mcp_service` secret, which only exists after `apply-mcp-clients.sh` has run
against that Keycloak.

## Gotchas

- **`/healthz` and `/readyz` do not touch Keycloak or Staticbot.** A probe that fails when a
  dependency is down converts their outage into a restart loop and makes recovery slower.
- **Service tokens are cached with a 30s margin and concurrent refreshes are collapsed.** Without
  that, every in-flight request mints its own token on expiry and Keycloak sees a burst of grants.
- **Staticbot's 403 bodies are surfaced verbatim** — after scrubbing. They name the cause — "Delegated
  scope 'staticbot:write' required", "Unknown Staticbot account for the asserted actor" — which a
  model can act on, where a bare status code just produces a retry loop. Scrubbed first because
  "verbatim" includes any secret the API quoted back: a rejected `provide_base44_secrets` call echoes
  the offending value into the reason string. See `src/log.md`.
- **`consentRequired: true` on `staticbot-openai` blocks the password grant**, so end-to-end testing
  needs the browser flow or a temporary change to that client. Verified by doing exactly that, then
  restoring both `consentRequired` and `directAccessGrantsEnabled`.

## Logging

Request-level events (`mcp.request`, `mcp.unauthorized`, `mcp.request_failed`) are emitted from
`res.on("finish")`/`"close"` rather than wrapped around handlers, so **every** exit path is
accounted for — including the 401 written before a handler is entered, and the 404. A `logged` guard
keeps a request that both finishes and closes from producing two lines.

Two decisions worth knowing:

- **`/healthz` and `/readyz` are never logged.** The probes run every 5s and 20s per replica — about
  43,000 requests a day — which would both bury the traffic worth reading and spend the whole
  retention budget on the word "ok". The check happens before any logging is wired up.
- **The actor is published onto the per-request context by `handleMcp`**, after token verification
  and before any tool runs. That is what lets a request line name a person, and it means a request
  that dies mid-flight still says who it was for. Lines for unauthenticated requests have no actor,
  which is correct rather than missing data.

Tool-call logging lives one layer down, in `createDelegatedContext`'s `apiFetch` — see `src/log.md`
for why that is the only place it needs to go, and for the redaction rules.

## Verified end to end (2026-08-31, local dev)

Real user token (`aud` = MCP resource, `scope` = `staticbot:read`) → `tools/list` returned 49 tools →
`tools/call list_templates` reached Staticbot, which just-in-time provisioned the user and their
organization, and returned template data.
