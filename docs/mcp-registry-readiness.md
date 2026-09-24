# MCP Registry and self-service OAuth readiness

Status: implementation review draft, updated 2026-09-23. No npm or registry publication was
performed while preparing this assessment.

## Decision

Staticbot is ready to prepare for registry publication, but broad self-service OAuth onboarding is
not enabled today.

Keycloak 26.7.3 supports unauthenticated OpenID Connect Dynamic Client Registration (DCR), and the
live realm advertises its `registration_endpoint`. The production realm's anonymous registration
policy currently restricts client URIs to `*.lovable.dev`, however. An arbitrary MCP client with a
loopback or unrelated web callback is therefore expected to be rejected.

The prepared Control Center change opens **native clients only** by allowing `localhost`,
`127.0.0.1`, and `[::1]` while retaining URI matching, consent, restricted scopes, and disabled full
scope. Keycloak 26.7.3 compares redirect-URI hosts literally, so all three loopback forms are needed.
This covers standards-compliant desktop and CLI clients without pre-creating or explicitly
allow-listing each client ID.

Do not use a wildcard trusted host and do not disable `client-uris-must-match` for an internet-facing
realm. That would admit arbitrary redirect and metadata URLs, remove the principal SSRF/phishing
guard around anonymous registration, and still leave an easy exhaustion attack against the realm's
200-client cap.

## Evidence

### Live endpoints (read-only checks)

- `https://app.staticbot.dev/auth/realms/staticbot/.well-known/openid-configuration` advertises
  `https://app.staticbot.dev/auth/realms/staticbot/clients-registrations/openid-connect` as its
  registration endpoint and exposes `staticbot:read` and `staticbot:write`.
- `https://mcp.staticbot.dev/.well-known/oauth-protected-resource` identifies the canonical resource,
  Keycloak issuer, and both Staticbot scopes.
- An unauthenticated request to `https://mcp.staticbot.dev/mcp` returns 401 with a
  `resource_metadata` challenge pointing to that protected-resource document.
- The live authorization metadata does not advertise `client_id_metadata_document_supported`.

### Disposable Keycloak verification (2026-09-23)

The updated dev realm was imported into a disposable Keycloak 26.7.3 container:

- IPv4 loopback DCR (`127.0.0.1`) returned 201; test-client deletion returned 204.
- IPv6 loopback DCR (`[::1]`) returned 201; test-client deletion returned 204.
- An unrelated HTTPS callback returned 403 from the trusted-host policy.
- The DCR-only live-realm apply mode updated both managed policies successfully.
- Both disposable containers were removed; production was not changed.

### Control Center configuration

The pre-change baseline inspected in the sibling `staticbot-control-center` repository was:

- The deployed production configuration has anonymous `Trusted Hosts`
  with `trusted-hosts: ["*.lovable.dev"]`, request-host matching off, and client-URI matching on.
- Production explicitly permits anonymous clients to request only `staticbot:read` and
  `staticbot:write` in addition to realm default scopes.
- Anonymous clients are forced to show consent, receive no full-scope role access, and are subject
  to a 200-client maximum.
- The deployed Dev and QA baselines have no trusted-host entries and require the request host to
  match, so anonymous DCR is effectively disabled there by the default policy.
- `staticbot-openai` remains a separately provisioned public client and does not depend on DCR.

The realm JSON establishes intended fresh-environment state. Because Keycloak import does not
overwrite an existing realm, a live-policy verification and an idempotent apply path are required
before claiming production matches a future change.

## Security and compatibility assessment

| Question | Answer |
| --- | --- |
| Does Keycloak support DCR without a client-registration token? | Yes. Anonymous OIDC DCR is supported and advertised by the live realm. |
| Can clients self-register today? | Only clients whose registered URIs satisfy the current `*.lovable.dev` policy. General MCP clients cannot be assumed to work. |
| Can native desktop/CLI clients self-register without explicit client IDs? | Yes. The prepared policy supports hostname, IPv4, and IPv6 loopback callbacks and passes isolated Keycloak tests. It still needs QA/prod deployment. |
| Can every web client self-register without any host policy? | Technically possible by weakening the policy, but not acceptable for the shared production realm. |
| Does DCR alone provide a durable open ecosystem path? | No. The current MCP specification deprecates DCR in favor of Client ID Metadata Documents (CIMD), so DCR should be treated as a compatibility bridge. |

Risks that remain even in the native-only phase:

1. Anonymous registrations are persistent and the 200-client limit can be exhausted. Put the
   registration endpoint behind rate limiting and add monitoring/cleanup before enabling it in prod.
2. Consent is necessary but does not make arbitrary client branding trustworthy. Keep the consent
   screen, show the redirect/client identity clearly, and do not grant default write scope.
3. Confirm every dynamically registered public client is authorization-code only, requires PKCE
   S256, has direct grants/device/CIBA disabled unless intentionally supported, and cannot add
   protocol mappers.
4. Keep client ID out of Staticbot authorization decisions. Authorization must continue to derive
   from the user, granted scopes, exact MCP audience, and the MCP service boundary.

## Recommended rollout

1. Review and merge the prepared idempotent Control Center apply path and realm-template changes.
2. Apply the DCR-only mode to QA; verify the live policy and repeat the loopback tests there.
3. Apply the same bounded policy to production after QA passes.
4. Add edge rate limits and alerts for registration failures, registration volume, and client-count
   headroom.
5. Keep explicit clients such as `staticbot-openai` for web products whose callback domains are
   known. Add trusted domains deliberately rather than opening a wildcard.
6. Track CIMD support as the long-term replacement. Keycloak's current discovery response does not
   advertise it, so this likely needs a Keycloak upgrade/extension or a small authorization facade.

### QA test matrix

All successful registrations must use a unique test prefix and be removed after inspection.

| Case | Expected result |
| --- | --- |
| Public native client, `application_type: native`, loopback callback, auth method `none` | Created; authorization code + PKCE S256 works |
| Same client requesting `staticbot:read` | Consent shown; access token has exact MCP audience and read scope |
| Same client requesting `staticbot:write` | Separate write consent shown; write is not silently defaulted |
| Callback on an unrelated HTTPS host | Rejected by trusted-host policy |
| Wildcard redirect URI | Rejected |
| Client credentials, password grant, implicit grant, device flow, or CIBA requested | Rejected or disabled according to the agreed profile |
| Custom protocol mapper or non-allow-listed scope | Rejected |
| Token minted for a different audience | Rejected by the MCP server |
| Repeated anonymous registrations above the rate threshold | Throttled before Keycloak |

## Registry artifact and release gate

`server.json` lists only the `@staticbot/mcp` npm package over stdio (API-key auth, no OAuth).
The hosted Streamable HTTP endpoint (`https://mcp.staticbot.dev/mcp`) is deliberately **not** listed
under `remotes` yet: until the DCR policy above is live in production, any registry-driven client
other than Lovable would fail OAuth registration against it. Add the `remotes` entry back (and bump
the registry version) once native DCR is enabled. `package.json` carries the matching ownership
marker:

```json
"mcpName": "io.github.bitfiction/staticbot"
```

The GitHub organization namespace requires the publisher to be an Owner of `bitfiction`. Publication
must wait until `@staticbot/mcp@1.8.1` (or the reviewed replacement version) is on npm, because the
already-published 1.8.0 tarball does not contain `mcpName` and npm versions are immutable.

Release sequence after review:

1. Merge the reviewed version and manifest changes.
2. Run the repository test suite and inspect `npm pack --dry-run`.
3. Publish the matching npm version.
4. Run `mcp-publisher validate server.json` (validation only).
5. Have a `bitfiction` organization Owner authenticate and review the final payload.
6. Run `mcp-publisher publish` only with explicit approval.
