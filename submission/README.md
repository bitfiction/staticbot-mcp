# ChatGPT remote submission

Run `npm run pack:chatgpt` to generate `artifacts/chatgpt/staticbot-<version>.zip`.
The builder uses the current listing and version from `.codex-plugin/plugin.json`,
converts the draft review cases from `chatgpt-app-submission.json`, and copies only
tracked skill files and the license. It changes the submission category to the
portal's `Developer Tools` title. The local stdio configuration stays in `.mcp.json`.
The [current unpublished draft](https://platform.openai.com/plugins/manage/plugin_asdk_app_6ae3b22b73dc8191b2830ef4b1770d7d)
accepted this portable package on 2026-10-29, including the remote OAuth settings
and seven skills. Upload subsequent versions to this draft using internal name
`staticbot`. The old legacy draft rejected both a changed internal name and the
MCP URL while showing its original endpoint as unavailable. A separate fresh
draft was created with the owner's explicit approval; the old draft remains intact.

`submission/mcp.json` declares the hosted HTTPS server and the existing public
`staticbot-openai` OAuth client. Read and write scopes are requested because the
plugin exposes both inspection and explicitly confirmed operations. PKCE S256 is
enforced by the registered client. No client secret, API key, account password,
reviewer credentials or access token belongs in this package.

Upload the ZIP as a new version of the current Staticbot draft. Then inspect the
saved MCP URL and authentication settings before connecting. The authoritative
redirect URI and domain-verification token come from that connection flow. The
registered production redirect currently is
`https://chatgpt.com/connector_platform_oauth_redirect`; register any different
portal callback exactly, without wildcards. Serve the portal's exact challenge
token at its displayed origin-root `/.well-known/openai-apps-challenge` URL.
`domain-verification.json` retains the current draft's public proof. The hosted
server supports `OPENAI_APPS_CHALLENGE_TOKEN`. This file is not included in the ZIP.
The infrastructure repository wires the matching optional
`mcp_openai_apps_challenge_token` variable from the ignored production tfvars.
On 2026-10-29, `release.sh prepare`, `release.sh build` and `release.sh deploy`
released `staticbot-mcp:1.8.38-prod` from MCP commit `738f987`. The running pod's
image digest matches the built image, health/readiness return 200, and the public
challenge returns the exact token as plain text with `Cache-Control: no-store`.
The current draft now visibly shows **Domain verified**. OAuth discovery exposes
the expected issuer/resource/scopes, and unauthenticated MCP requests return 401.
On 2026-10-30, the owner approved starting Connect. The real portal OAuth request
returned `invalid_scope`: it requests `openid email offline_access staticbot:read
staticbot:write`, but the registered client omitted optional `offline_access`.
Unauthenticated scope probes isolate that permission: the same request without it
reaches `login_required`, while adding it returns `invalid_scope` before login.
After the owner's explicit approval, `release.sh mcp-oauth-scopes --apply` attached
only optional `offline_access` to the existing production client and verified
readback. The inspected client security settings, defaults and other scope bindings
are unchanged. The canonical definition and dev/qa/prod fresh-realm imports contain
the same optional scope. All 43 isolated release/OAuth helper tests pass.
The full unauthenticated authorization probe now reaches `login_required`, and the
real portal retry visibly opens Staticbot's sign-in page with the expected client,
redirect, resource, scopes and S256 challenge. The owner completed login/consent
using the main testing account, which is not the reviewer account and must not be
provided as reviewer credentials. Token exchange then returned 400. Keycloak's
matching event says `Offline tokens not allowed for the user or client`; read-only
checks confirm the scope has the required role mapping, while this testing account
lacks the standard realm `offline_access` role. A targeted `release.sh mcp-oauth-user`
plan/apply command is prepared, but the owner chose a separate reviewer account.
The main testing account's roles remain unchanged.

On 2026-10-31, read-only checks found exactly one dedicated reviewer account. It is
enabled, has effective `offline_access`, has a password
credential, has no pending required actions, and has no OTP credential configured.
Its email is not marked verified; complete verification before reviewer handover.
The owner is preparing the account's demo workspace and projects. Current draft
cases need available templates, a deployment with inspectable status/DNS information,
a migration with inspectable status/next action, and a connected demo project in
`PAUSED` sync mode. The website-scan case uses a public URL. Public health/readiness,
the exact domain proof, OAuth discovery, unauthenticated 401 protection and full
requested-scope acceptance were rechecked successfully. These checks do not establish
successful reviewer login, token exchange, tool discovery or workflow execution;
the completed portal OAuth connection and tool scan remain unverified.

This archive is for connection setup, not a verified final submission. Review
cases still need real account fixtures and workflow runs. The demo video, support
URL and listing icon are not supplied by this builder. A successful package upload
does not prove these requirements are complete. The live V1 contract now contains
all 128 operations, including the four cutover routes, and the hosted image contains
all 112 MCP tools. Their authenticated reviewer workflows still need verification.
All seven skill checks have passed in the portal; support URL, icon and review
information remain blocking findings.
Credentials and reviewer access instructions go in the portal's secure form.

References: [packaging and OAuth configuration](https://developers.openai.com/plugins/build/plugins),
[submission and verification](https://developers.openai.com/plugins/deploy/submission).
