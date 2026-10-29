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
server now supports `OPENAI_APPS_CHALLENGE_TOKEN`; deploy that implementation and
set the token before selecting Verify Domain. This file is not included in the ZIP.
The infrastructure repository's compute module and production environment have
the matching optional `mcp_openai_apps_challenge_token` variable prepared, with
the public token in the ignored local production tfvars. OpenTofu validation
passes. The endpoint and deployment configuration have not been released.
Authorize the connection in the browser, then inspect the completed tool scan.

This archive is for connection setup, not a verified final submission. Review
cases still need real account fixtures and workflow runs. The demo video, support
URL and listing icon are not supplied by this builder. A successful package upload
does not prove these requirements are complete. The four new cutover operations
also require the backend release before the hosted MCP release and a fresh scan.
Credentials and reviewer access instructions go in the portal's secure form.

References: [packaging and OAuth configuration](https://developers.openai.com/plugins/build/plugins),
[submission and verification](https://developers.openai.com/plugins/deploy/submission).
