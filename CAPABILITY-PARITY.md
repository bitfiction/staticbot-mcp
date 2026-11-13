# V1 / MCP capability check — 2026-11-13

The latest audit checks current controllers, runtime MCP tool coverage, focused backend tests,
production OpenAPI, deployed images and public MCP/OAuth endpoints. It does not establish
authenticated reviewer workflows or submission readiness. Earlier dated sections retain the
scope of their original checks.

## Current readiness — 2026-11-13

| Surface | Verified state |
| --- | --- |
| V1 source | 141 operations after the local project-launch addition. Controller inventory and internal-gap guardrails pass. |
| MCP source | 123 runtime tools exercise 133 V1 routes. Eight deliberate exclusions are listed below. Parity passes against the current backend contract. |
| Production V1 | Read-only audit before this implementation: 139 operations matching the then-current source. The two new project-launch routes need a release. |
| Hosted MCP | The pre-implementation audit found `staticbot-mcp:1.8.44-prod` at committed main `c20eb35`, with 121 tools. One ready replica, zero restarts; health/readiness return 200. Pod digest: `sha256:0ec065a5e3b135c49a2e81e6cefab8addabd64c6069b301d76696fbdec3dd206`. The two local launch tools need a release. |
| Backend release | `staticbot-app:1.9.306-prod` has one ready replica. Its release tag points to `8dd09e85`: two main commits follow it, the auth callback registration fix `30eac040` and triage documentation `5a1147e7`. These do not add V1 routes. |
| OAuth and domain proof | The advertised resource metadata and issuer discovery return 200. The domain proof matches exactly, as plain text with `no-store`; unauthenticated MCP returns 401. A `prompt=none` probe with the portal's full scopes returns `login_required`, without a client/scope error. This is not a completed token exchange. |
| npm | Registry latest remains `1.8.2`; source is `1.8.3`. This is separate from the current hosted image. |
| Reviewer and portal | Last account/portal observations remain the dated records below. This audit did not sign in, reconnect the draft, verify fixtures, run reviewer workflows or record the video. |

Validation: the full MCP suite passes. The documented launch regression batch passes 744 backend
tests, including seven PostgreSQL tests exercising real commits/rollback and concurrent launch
exclusion with auto-commit disabled. Route coverage does not prove every request/response field or
a real workflow against an authenticated production account.

### Connected-project launch implemented locally — 2026-11-13

The earlier consolidation was already implemented in November 7 commits; its planning document's
"parked" header was stale. Both generic UI/V1 paths already use `DeploymentWorkflow`,
`StackLaunchWorkflow`, `RepositoryTemplateImport`, `AwsHostingOptionsQuery` and `DeploymentFactsQuery`.
The remaining project-launch extension is implemented in backend commit `153cd6a4` and the local MCP tools:

| V1 operation | MCP tool |
| --- | --- |
| `GET /api/v1/connected-projects/{id}/hosting/launch?templateId=…` | `get_connected_project_launch` |
| `POST /api/v1/connected-projects/{id}/hosting/launch` | `launch_connected_project` |

Inspection is side-effect free and returns a value-free plan, backend URL, sign-in choices and owned
domain choices. Creation requires explicit confirmation, the exact template version/state and the
user's domain/backend/sign-in choices. The shared setup transaction rechecks current authority under
the project lock, applies stored backend configuration, and binds the new stack and Live stage.
Fixed client backends remain fixed. API credentials do not acquire a fabricated person milestone.

`CONFIGURED` is hosting setup only. Use `create_deployment` with the returned stack ID, then
`start_deployment` separately. Credential-scoped creation rechecks project configuration authority
and commits its deployment pointer with the new deployment, taking project then stack locks like
the browser. Trusted internal callers retain their existing behavior. Stale approvals, duplicate
families and existing hosting return useful conflicts; no implicit retry or deployment is performed.
Public projections omit configuration/credentials and sanitize error diagnostics.

The earlier 139-route production parity result predates these changes. No production release,
reviewer workflow or portal scan was performed for this implementation. No worker or schema change
is required; release the backend before MCP through `release.sh`.

Website URL scanning is already exposed through `scan_website` / `get_website_scan` and authenticated
workspace-owned `/api/v1/site-scans` routes. This entry point does not use browser Turnstile. A target
website's own Cloudflare/access restrictions can still prevent a scan.

### Dashboard capabilities still outside V1/MCP

The current internal-route baseline contains 167 method/path differences. These are routes, not
167 independent features; the baseline includes deferred workflows and deliberate differences.
Passing V1-to-MCP parity does not close this separate dashboard-to-V1 backlog.

- Project/migration/template lifecycle operations, deployment runtime logs and additional preview
  checks, general DNS-zone management, billing reads and provider connection-health checks.
- Dynamic Website collection/record/export management and forms. Exposing visitor data requires
  a deliberate authorization and response contract.

The recent sign-in page, Google sign-in status, pipeline read/approve/reject/gate, and deployment
abort/destroy additions are deployed. Saving Google client secrets remains outside MCP by design.

## Sign in with Google — 2026-11-11

The project's Domain and auth tab gained a "Sign in with Google" section, with V1 counterparts:

| V1 operation | MCP tool | Bound to |
| --- | --- | --- |
| `GET /api/v1/connected-projects/{id}/google-sign-in` | `get_google_sign_in` | – |
| `PUT /api/v1/connected-projects/{id}/google-sign-in` | none (baseline) | the Google client secret |

Saving takes the user's Google client secret, so it is a deliberate difference like
`provide-base44-secrets`: V1 refuses it for MCP-delegated callers (403 `SECRET_INTAKE_REFUSED`) and the
tool description sends the user to the browser. API-key callers keep it. Runtime tools: 121.

## Release path tools — 2026-11-11

Eight new V1 operations and tools close the gap between "an agent can deploy" and "an agent can run a
project's release". The app's parity baseline drops from 175 to 167:

| V1 operation | MCP tool | Bound to |
| --- | --- | --- |
| `GET /api/v1/connected-projects/{id}/sign-in-page` | `get_sign_in_page` | – |
| `PUT /api/v1/connected-projects/{id}/sign-in-page` | `set_sign_in_page` | `confirmed` |
| `GET /api/v1/connected-projects/{id}/pipeline` | `get_release_pipeline` | – |
| `POST …/pipeline/stages/{stageId}/approve` | `approve_release` | `confirmed` + `expectedCommitSha` |
| `POST …/pipeline/stages/{stageId}/reject` | `reject_release` | `confirmed` + `expectedCommitSha` |
| `PATCH …/pipeline/stages/{stageId}/gate` | `set_release_gate` | `confirmed` |
| `POST /api/v1/deployments/{id}/abort` | `abort_deployment` | `confirmed` |
| `POST /api/v1/deployments/{id}/destroy` | `destroy_deployment` | `confirmed` + `expectedStatus` |

A sign-off on a stage that has since re-armed on a newer push, or a destroy on a deployment whose status
changed, answers 409 and is reported, never retried (`scripts/check-release-contracts.mjs`, both
credential contexts). Inventory: 137 V1 operations, 120 runtime tools, 130 covered routes, and the
same seven deliberate differences. A connected project's first go-live (the hosting launch with its
domain and sign-in choices) is not in V1 yet; the app's
`docs/follow-ups/2026-11-11-ui-v1-mcp-parity-gaps.md` has the design.

## V1 drift closed — 2026-11-11

The app's Dynamic Websites work added `POST /api/v1/migrations/{id}/recheck-dynamic-site` (the gate
action `RECHECK_DYNAMIC_SITE`). `recheck_migration_gate` now routes that action there, and the contract
snapshot is refreshed: 129 V1 operations, 122 covered by 112 runtime tools, and the same seven deliberate
differences. App CI had not reported the gap because its integration tests failed before the parity step ran.

## Historical readiness snapshot — 2026-10-31

| Surface | Verified state |
| --- | --- |
| V1 source contract | 128 operations, including the four new cutover operations; the backend controller-inventory and internal-gap guardrails pass. |
| MCP source | 112 runtime tools exercise 121 V1 routes; seven deliberate differences remain listed below. |
| Live V1 API | Last verified on 2026-10-29: the deployed OpenAPI inventory returns 128 operations, including all four cutover routes. Authenticated workflow behavior still requires real fixtures. |
| Hosted MCP | `release.sh` released `staticbot-mcp:1.8.38-prod` from commit `738f987`. One replica is ready with zero restarts and the expected immutable image digest. Health/readiness and OAuth discovery pass; unauthenticated MCP returns 401. The image contains 112 tools, including the four cutover tools. |
| Portal connection | The draft was verified as **Domain verified**. The approved optional `offline_access` client binding is live. The earlier main-testing-account exchange failed because that user lacks the realm role; the owner chose to leave it unchanged. Reviewer token exchange and completed tool discovery/scan remain unverified. All seven skill checks passed. |
| Reviewer account | Read-only checks on 2026-10-31 confirm one enabled account, effective `offline_access`, a password credential, no pending required actions and no OTP credential. Email is not marked verified. Demo workspace/projects and real login/workflow checks remain to be completed. |
| Published npm package | The last registry check on 2026-10-29 found `@staticbot/mcp` at `1.8.2`; this checkout is `1.8.3`. The hosted image and npm publication are separate releases. |
| Package preparation | `npm pack --dry-run` passes for `1.8.3` and includes the new tool modules and plugin configuration. Nothing was published by this work. |

The previous workflow, branch preview, source-update and external-authentication additions remain
covered. Website URL scanning is already exposed through `scan_website` / `get_website_scan` and
owned `/api/v1/site-scans` routes; browser Turnstile is not needed for this authenticated entry point.
Target sites' own Cloudflare/access restrictions still apply.

Since the previous feature batch, V1/MCP also gained:

- `switch_connected_project_migration_backend`: explicitly switch a project's backend to a completed
  migration of the same app, with confirmation and backend eligibility checks.
- `refresh_platform_update`: queue an update's read-only metadata refresh separately from installing it.
- `test_connection_credentials`: ask Google or Dropbox about a saved connection's OAuth client,
  using either the project or migration selector. No credential values enter or leave the tool;
  acceptance is not proof of a working redirect or end-user connection.

### Cutover API/MCP implementation released — 2026-10-29

The project's **Switch tab / cutover watch** now has four V1 operations and four MCP tools:

| V1 operation | MCP tool |
| --- | --- |
| `GET /api/v1/connected-projects/{id}/cutover` | `get_connected_project_cutover` |
| `POST /api/v1/connected-projects/{id}/cutover/check` | `check_connected_project_cutover` |
| `POST /api/v1/connected-projects/{id}/cutover/copy` | `copy_connected_project_late_changes` |
| `POST /api/v1/connected-projects/{id}/cutover/conflicts/reviewed` | `mark_cutover_conflicts_reviewed` |

GET reads retained evidence without enrollment, scan reconciliation or notifications. Check uses
the existing guarded scanner and bounded source reader, can send configured workspace notifications,
and never queues a copy. Unknown and incomplete evidence remains qualified.

Copy and conflict review use scoped V1 authority and require `confirmed=true` plus the exact inspected
`stateVersion` as `expectedState`. Copy also requires an explicit INSERT_ONLY or FULL_UPDATE mode.
The snapshot binds project/source/import settings, target, watch evidence, copy window and last-copy
results. The service reauthorizes and rechecks it under project/watch locks before writes. Changed
state returns 409 and cannot silently substitute a new window, backend or copy. Replays of an old
approval cannot start a second copy or review newer conflicts. The worker reads current source rows
after the approved lower bound, not a frozen set of the observed rows.

Public responses contain explicit identities, timestamps, qualified counts and bounded summaries;
worker inputs, row values, raw provider errors and signed file URLs are excluded. Conflict lists
are capped at 20 with a truncation indicator; the user must review any remaining conflicts in the
dashboard. Marking review advances Staticbot's source window and does not repair database records.
Legacy migrations with no recorded source app ID remain readable, but API copying is refused because
inspection cannot identify their encrypted-integration fallback; those copies use the dashboard.

The previous four internal-route deferrals have been removed. This extension needs no database
migration or worker change. The backend and hosted MCP have now been released; refresh the
portal scan after connecting its account. No customer copy was performed by this audit.

Other documented dashboard gaps remain, including project linking, additional pipeline administration,
deployment record cleanup/deletion and general DNS-zone management. Passing V1-to-MCP coverage does not
mean every dashboard feature has a public endpoint. Secret entry remains a deliberate browser boundary.

### Cutover validation and submission follow-through — 2026-10-29

The full MCP suite passes, including all 112 tools, submission annotations/cases and route parity
against the regenerated backend contract. The new cutover adapter checks exercise both API-key and
delegated OAuth contexts, exact-state forwarding, both copy modes, invalid confirmations, retained
unknown evidence and no implicit copy/review/retry calls. The focused backend batch passes 94 tests,
including six PostgreSQL transaction tests. Backend checks cover current roles/scopes,
tenant isolation, value-free projections, stale windows/settings/backends, revocation under locks
and replay refusal. PostgreSQL tests invoke the proxied service with auto-commit disabled and verify
commits/rollback through independent connections. Package and discovery validation also pass.

The capability audit did not log in as the reviewer, run the five submission scenarios against real
fixtures, record a video or submit the application. Those remain unverified. Portal connection
preparation is recorded below.
The existing local plugin configuration still launches stdio with `STATICBOT_API_KEY`; a hosted
submission needs the appropriate remote OAuth configuration and a fresh portal tool scan. Verify
reviewer access and fixtures, confirm the portal connects to the current hosted release, then record
the final demo. The npm publication is a separate release task and is not evidence that the hosted
server is stale.

### Remote submission connection preparation — 2026-10-29

The legacy OpenAI portal draft was inspected directly. It has no displayed MCP
URL or authentication settings, no discovered tools, and no domain-verification
state. The portal rejected a remote package update because it requires an
original URL that it no longer displays or allows editing. The owner explicitly
authorized creating a separate unpublished draft; the old draft remains intact.

The [current draft](https://platform.openai.com/plugins/manage/plugin_asdk_app_6ae3b22b73dc8191b2830ef4b1770d7d)
accepted version 1.8.3 with seven skills and the existing five positive/three
negative draft cases. Its saved settings show the correct HTTPS MCP endpoint,
MCP key `staticbot`, OAuth `provided` client `staticbot-openai`, token endpoint
authentication `none`, explicit endpoints/resource and read/write scopes. No
client-secret field is required. It now shows authorization required and domain
verified, instead of unavailable connection metadata.

`npm run pack:chatgpt` now produces a separate remote draft ZIP from the current
listing, tracked skills and existing review cases. `submission/mcp.json` declares
`https://mcp.staticbot.dev/mcp`, the registered public `staticbot-openai` client,
token endpoint authentication `none`, and the read/write scopes. No client secret
is needed. This leaves the local stdio configuration intact. Archive integrity,
allowlisted contents, mapped review cases, versions and submission metadata pass
local checks. Future uploads use internal name `staticbot` and the current draft.

The live client accepted an intentionally invalid authorization code without a
client secret and returned `invalid_grant`, rather than `invalid_client`. An
authorization-start probe found no invalid client, redirect or scope response.
These checks do not establish successful login, consent or token exchange.
The default `https://mcp.staticbot.dev/.well-known/openai-apps-challenge` now returns
200 with the portal's exact token, no newline, a plain-text content type and
`Cache-Control: no-store`. The public proof is retained in
`submission/domain-verification.json`, outside the public ZIP, and is configured
through `OPENAI_APPS_CHALLENGE_TOKEN`. The owner-approved production release went
through `release.sh prepare`, `release.sh build` and `release.sh deploy`, applying
one in-place MCP deployment update and no other resource changes. The running
`1.8.38-prod` image has digest
`sha256:d83f7188649e120868b0582ab182e98ca45af33995e9f148edaeae836b6e611c`.
The portal's Verify Domain action succeeded and visibly shows Domain verified.
OAuth discovery passes and unauthenticated MCP still returns 401. Full MCP tests,
production OpenTofu validation and 26 isolated release-script tests pass.
The owner approved starting Connect on 2026-10-30. The real portal request then
returned `invalid_scope` for `openid email offline_access staticbot:read
staticbot:write`, before login. Unauthenticated probes isolate `offline_access`:
without it, the same client/redirect/PKCE request reaches `login_required`; adding
it returns `invalid_scope`. The canonical registered-client definition omitted that
optional scope. After the owner's explicit approval, `release.sh mcp-oauth-scopes
--apply` attached only optional `offline_access` to the existing production client
and verified readback. The public-client, consent, PKCE and existing read/write
binding checks pass; inspected security settings, default scopes and other bindings
are unchanged. The canonical definition and dev/qa/prod fresh-realm imports contain
the same optional scope. All 43 isolated release/OAuth helper tests pass.
The full unauthenticated request now reaches `login_required`, and a real portal
retry visibly opens Staticbot's sign-in page with the expected client, stable
redirect, resource, scopes and S256 challenge. The owner then completed login/consent
with the main testing account, which must not be handed to reviewers. Token exchange
returned 400. The matching Keycloak event reports `Offline tokens not allowed for the
user or client`. Read-only checks confirm the optional scope's required role mapping
is present but the failed exchange's user lacks the standard realm `offline_access`
role. A targeted `release.sh mcp-oauth-user` plan/apply command is prepared, but the
owner chose to leave that account's roles unchanged and use a dedicated reviewer
account. Read-only checks on 2026-10-31 confirm the reviewer account is unique and
enabled, has effective `offline_access` and a password credential, has no pending
required actions and has no OTP credential configured. Its email is not marked
verified. Public health/readiness, domain-proof bytes, OAuth discovery/protection
and full requested-scope acceptance pass again. Successful reviewer login, token
exchange, tool discovery and workflow runs remain unverified. The owner is preparing
demo workspace/projects; email verification remains to be completed before handover.

Portal metadata checks confirm the support URL, primary icon and review details
are still required. Non-blocking findings mention other AI platforms and an
incomplete automated privacy-policy assessment. All seven skill scans now show
Checks passed. Reviewer fixtures/runs and the demo video remain unverified.
Nothing has been submitted for review or published.

The platform-reference finding says the plugin's name or description references
another AI assistant, model or platform; it does not assert that Staticbot uses
another model provider. Neither uploaded ZIP contains a DeepSeek reference.
Base44, Lovable and Bolt in the public description are migration sources and are
the likely trigger, though the finding does not identify a matched phrase.
The same non-blocking platform-reference finding remains visible after deployment
and domain verification.

## Automated route guardrails — 2026-10-17

`npm test` now runs `validate:api-parity`. It discovers every runtime tool from `createServer`,
invokes the actual handlers with an in-memory recording `ToolContext`, and compares their HTTP
methods/paths with `contracts/app-v1-openapi.json`. No customer API calls are made. Query strings
and path-variable names do not affect matching. Route-changing enum values are probed, and
`get_app_secrets` exercises its project, migration and stack selectors separately. Explicit fixtures
cover valid migration creation; browser-only Firebase/error handoffs remain in the existing tests.
Every tool must make an observed request; unsupported schemas/probes fail visibly.

The snapshot is generated by staticbot-app's `ApiParityContractTest` from Spring controller mappings.
It inventories operations, not request/response schemas. The app test fails whenever that file drifts
from the controllers. The app's build workflow also checks the current app contract against MCP main,
so an app route addition cannot rely on an old snapshot in this repository to escape the guardrail.
Standalone MCP tests use the checked-in snapshot and need no application server or network.

To compare another checkout or a deployed OpenAPI specification after building:

```sh
npm run build
node scripts/check-api-parity.mjs --openapi ../staticbot-app/docs/api/v1-route-contract.json
node scripts/check-api-parity.mjs --openapi https://app.staticbot.dev/v3/api-docs/v1
```

Refresh the snapshot explicitly from the app-generated contract after backend route changes.
The checker fails for new uncovered V1 routes, tools calling missing routes/wrong methods, and
baseline entries whose gap has closed or whose API route was removed. It does not auto-accept gaps.
`contracts/api-mcp-parity-baseline.txt` keeps method/path entries; context belongs here and in the
app follow-up docs. No date/reason syntax is required per baseline line.

### Latest backend alignment — 2026-10-26

Compared with the current app-generated contract, all 109 V1 operations are now accounted for:
102 are exercised by the 96 runtime tools and seven remain deliberate differences below.
The snapshot now includes the current migration source-recovery GET/POST and SQL syntax recheck.
`get_migration_source_recovery` reads eligibility and the exact approved revision/commit;
`restore_migration_source_snapshot` requires approval of that exact pair and never resumes or retries.
`recheck_migration_gate` now supports `RECHECK_SQL_SYNTAX`, with explicit source re-prepare approval.
This adopts the latest source commit, reruns discovery and returns to a new plan review, without
approving target writes. Existing capacity rechecks can continue an already-approved stopped import.
Focused adapter tests cover both credential contexts, invalid confirmations, changed snapshots,
execution locks, refused SQL rechecks and the absence of implicit confirm/resume/retry calls.

This is local source and contract verification. The hosted release must be updated and its tool scan
refreshed before claiming these additions are available to reviewers. No production mutation or
submission was performed on 2026-10-26.

### Backend, previews, source updates and external authentication — 2026-10-26

This extension adds eleven V1 operations and nine tools: 120 V1 operations are now accounted for,
113 exercised by 105 runtime tools and the same seven deliberate differences. The snapshot is
regenerated from the backend controller mappings. This remains a source-level contract check.

| Capability | V1 routes | MCP tools |
| --- | --- | --- |
| Shared backend workflow state/actions | GET `/{connected-projects,migrations}/{id}/backend`; POST the same path plus `/workflows` | `get_backend_workflows`, `operate_backend_workflows` (exactly one project/migration selector) |
| Feature-branch preview settings | GET/PUT `/connected-projects/{id}/feature-branch-previews` | `get_feature_branch_preview_settings`, `set_feature_branch_preview_settings` |
| Build a tracked feature-branch preview | POST `/connected-projects/{id}/branches/preview` | `build_feature_branch_preview` |
| Preview/apply source re-preparation | GET/POST `/migrations/{id}/source-update` | `preview_migration_source_update`, `update_migration_source` |
| Authentication for an external frontend | GET/POST `/connected-projects/{id}/hosting/auth-domain` | `get_external_auth_domain`, `set_external_auth_domain` |

All paths above are under `/api/v1`. Existing sync accepts `redeployAllFunctions`; it requires
`confirmed=true` only when force redeploying every function. An ordinary sync keeps its previous
request shape. The sync boundary now checks current production-operation permission and stored links.

Backend actions retain the Base44/Supabase Cloud scope, exact environment/project reference and
observed flags. All shared stages, including production, are displayed before confirmation. An
UNVERIFIED remote outcome stays unknown and never triggers an automatic retry. Defer and verify
record decisions; neither means the app's real workflows have been tested.

Branch reads now include `build` availability/hints. Builds require the inspected commit and hint,
including the plan-limit eviction consequence; changed values return 409 before provisioning.
Preview settings retain hosting-plan eligibility and the existing transactional writer.

Source re-prepare resolves the chosen template version before approval. The read response is an
explicit projection: credential-bearing prepared plans never enter public JSON. Applying requires
the exact full commit and explicit approval, invalidates the previous plan approval and returns to
new discovery review. Existing execution/target/feature guards remain enforced.

External authentication reuses the same service and transaction boundaries as the browser. Each
adapter supplies current authority; the API adapter rechecks scope, membership, production policy,
links and the inspected backend binding inside the project/authentication locks. Hostname validation,
concurrent domain-move/job guards and worker readback remain unchanged. Secret values stay server-side.
UPDATED proves configuration readback, not login/reset/magic-link functionality or a hosting move.

The focused backend batch and full MCP suite pass. Real provider/reviewer-fixture runs and production
deployment remain release validation. Deploy the backend before the hosted MCP server and refresh
the portal scan after release.

### Eight current route differences

| V1 route | Context |
| --- | --- |
| `GET /api/v1/onboarding/unsubscribe` | Signed email unsubscribe link, not a general agent action. |
| `POST /api/v1/mcp/client-connections` | Connection registration/control plane; not an end-user business tool. |
| `POST /api/v1/migrations/{}/jobs/{}/provide-base44-secrets` | Deliberate credential boundary. Secret values are entered in the dashboard; MCP exposes secret names/state and the browser handoff. Do not create a credential-taking tool to close this row. |
| `PUT /api/v1/connected-projects/{}/google-sign-in` | Takes the Google client secret. Available to API-key callers; delegated MCP callers use the browser handoff. `get_google_sign_in` exposes status and setup information. |
| `POST /api/v1/public/site-scans` | Anonymous browser onboarding/anti-abuse flow. MCP starts owned checks through `POST /api/v1/site-scans`. |
| `GET /api/v1/public/site-scans/{}` | Anonymous result flow. MCP reads owned results through `GET /api/v1/site-scans/{id}`. |
| `GET /api/v1/public/site-scans/{}/screenshot` | Browser screenshot response. A future image tool needs a tested media/authorization contract; existing result reads do not establish screenshot parity. |
| `POST /api/v1/public/site-scans/{}/report` | Browser report delivery/consent flow. Adding agent report delivery requires its own input/authorization contract. |

These checks establish route coverage. Request fields, response fields, permission behavior and
confirmation semantics remain the responsibility of the focused contract tests. A planned
`GET /api/v1/pricing` that has not been implemented is still work in the app's
`2026-10-16-plan-facts-single-source.md`; route discovery cannot infer an endpoint that does not exist.

## Earlier capability additions

| Capability | V1 API | MCP |
| --- | --- | --- |
| Start/reuse a website URL check | `POST /api/v1/site-scans` | `scan_website` |
| Poll an owned website check | `GET /api/v1/site-scans/{id}` | `get_website_scan` |
| Read deterministic preview evidence | Existing `GET /api/v1/migrations/{id}/preview-evidence` | `get_migration_preview_evidence` |
| Read/set a migration's live URL | `GET` / `PUT /api/v1/migrations/{id}/live-site` | `get_migration_live_site`, `set_migration_live_site` |
| Read retained live-commit comparison | `GET /api/v1/migrations/{id}/live-commit-check` | `get_migration_live_commit_check` |
| Inspect branch targets and shared webhook scope | `GET /api/v1/connected-projects/{id}/operations` | `get_connected_project_operations` |
| Build a branch preview | `POST /api/v1/connected-projects/{id}/build-preview` | `build_connected_project_preview` |
| Switch live to the builder branch | `POST /api/v1/connected-projects/{id}/live-branch` | `switch_connected_project_live_branch` |
| Sync the migration preview onto live | `POST /api/v1/connected-projects/{id}/sync-to-live` | `sync_connected_project_to_live` |
| Set up/reset/disable a GitHub webhook | `POST /api/v1/connected-projects/{id}/{setup,reset,disable}-webhook` | `{setup,reset,disable}_connected_project_webhook` |

The website routes accept the existing customer API-key or delegated MCP authentication. Tenant IDs
come only from `RequestOrganization`. Starting requires delegated `staticbot:write`; polling requires
`staticbot:read`. API-key scans record `api-key`; delegated scans record the resolved human username.

They reuse `SiteScanService.startWorkspaceScan`, including cache reuse, workspace quota, per-target
throttle, admission, guarded fetching and the bounded queue. They need no connected integrations.
Only the customer summary is returned: no persisted scan object, raw extracted items or contact
history. Existing anonymous `/api/v1/public/site-scans` keeps its Turnstile verification.

Cloudflare on the requested target site remains independent: a failed fetch is reported as a scan
failure. Adding an authenticated entry point does not grant access to protected target content.

## Operation authorization and confirmation

The second extension adds ten V1 operations and ten MCP tools (nine requested actions plus one
inspection read). It reuses existing preview/live/GitHub services and needs no database migration.
`V1WorkspaceAccess` preserves organization API-key authority and rechecks delegated users' current
workspace membership, OAuth scope and role. `ApiV1ProjectAccess` reuses `ProjectAccessPolicy` and
the persisted-link/branch ownership rules. Feature flags and agency-client restrictions still apply.

Preview/live/webhook mutations require `confirmed: true`. Live-branch operations also require the
inspected `expectedLiveBranch` and `expectedBuilderBranch`; changed targets return 409. Webhook writes
require `expectedRepositoryConfigId` from the inspection response and disclose the shared project
and template scope. Webhook secrets stay inside the existing transactional writer. Upstream deletion
is best-effort and is never reported as verified. A live switch can persist while its redeploy fails;
the V1/MCP response preserves that partial outcome.

Migration live-site reads omit raw script/items. A missing scan or commit comparison returns 204;
an UNKNOWN comparison remains unknown, and `checkedAt` is retained evidence rather than a new probe.

## Remaining gaps and deliberate differences

The newer dashboard is broader than V1/MCP. Examples confirmed in current source:

- Reattaching a connected project to an existing stack or deployment remains a separate browser-only
  capability; the new first-launch operation links its own new stack. Project creation/deletion,
  collaboration, delivery and additional pipeline administration are
  outside these two requested gaps. This change does not claim complete dashboard parity.
- Credential intake is deliberately different. V1's Base44-secret endpoint exists for API-key
  callers, while delegated MCP rejects credential material. MCP sends the user to the dashboard.
  Do not restore `provide_base44_secrets` or the old `scan_deployed_url` key-extraction contract.
- Migration histories, source inspection, handoff reports, AWS/Cloudflare ownership choices and
  Supabase provisioning already have MCP tools. A simple text comparison can falsely report gaps
  for their parameterized paths, so route counts alone do not establish parity.

This check does not claim every dashboard operation, request field or response field has parity.

## Submission maintenance

`chatgpt-app-submission.json` now covers all 123 local runtime tools with explicit annotations and
justifications, exactly five positive cases and three negative cases. The one-time data-import gate
test was replaced with a website check. Positive tests still need real reviewer fixtures and a live
run; metadata validation is not an execution result.

`npm run validate:submission` compares the inventory and required annotations to runtime discovery,
checks justifications and case counts, and checks the listing subtitle limit. It is part of
`npm test`. The local Codex plugin remains a local-transport package; the hosted submission still
needs its remote OAuth package configuration, reviewer account, recording, domain verification and
successful portal scans.

## Release order

1. Deploy the new backend V1 routes.
2. Deploy the MCP server containing the new tools.
3. Verify real API-key and OAuth flows on disposable reviewer fixtures, including read-only denial,
   tenant isolation, explicit operation confirmation and stale-target rejection.
4. Refresh the hosted submission package and portal tool scan before recording the final demo.

No deployment or submission was performed as part of this source change.
