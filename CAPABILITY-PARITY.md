# V1 / MCP capability check — 2026-10-29

The latest check covers current source, focused tests, the live V1 route inventory and read-only
production deployment metadata. It does not certify authenticated reviewer workflows or portal
submission readiness. Earlier dated sections below retain the scope of their original checks.

## Current readiness — 2026-10-29

| Surface | Verified state |
| --- | --- |
| V1 source contract | 128 operations, including the four new cutover operations; the backend controller-inventory and internal-gap guardrails pass. |
| MCP source | 112 runtime tools exercise 121 V1 routes; seven deliberate differences remain listed below. |
| Live V1 API | The earlier read-only audit returned 124 operations. The four new cutover routes require a backend release; source coverage is not evidence of live availability. |
| Hosted MCP | The earlier audit found one ready replica of `staticbot-mcp:1.8.37-prod`, matching committed main `dfcaaad`, with passing health/readiness and OAuth discovery. The new cutover tools are local changes after that release and require a hosted MCP release. |
| Published npm package | npm's latest `@staticbot/mcp` is still `1.8.2`; this checkout is `1.8.3`. The current hosted image and the npm publication are separate releases. |
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

### Cutover gap closed locally — 2026-10-29

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
migration or worker change. Deploy the backend before the hosted MCP and refresh the portal scan.
No production deployment or customer copy was performed as part of this implementation.

Other documented dashboard gaps remain, including project linking, pipeline administration,
deployment cleanup/destruction and general DNS-zone management. Passing V1-to-MCP coverage does not
mean every dashboard feature has a public endpoint. Secret entry remains a deliberate browser boundary.

### Validation and submission follow-through

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
not verified, instead of unavailable connection metadata.

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
The default `https://mcp.staticbot.dev/.well-known/openai-apps-challenge` returned
404. The current portal-generated public proof is retained in
`submission/domain-verification.json`, outside the public ZIP. The hosted server
now supports serving it as exact plain text through `OPENAI_APPS_CHALLENGE_TOKEN`.
The infrastructure repository has the corresponding optional variable, production
wiring and local production value prepared. Full MCP tests and production
OpenTofu validation pass. No production deployment or domain verification was
performed. Release the backend before the latest MCP toolset, then verify the
domain, authorize the scan account in the browser and inspect the completed scan.

Portal metadata checks confirm the support URL, primary icon and review details
are still required. Non-blocking findings mention other AI platforms and an
incomplete automated privacy-policy assessment. Skill scans were still pending
when first inspected. Reviewer fixtures/runs and the demo video remain unverified.
Nothing has been submitted for review or published.

The platform-reference finding says the plugin's name or description references
another AI assistant, model or platform; it does not assert that Staticbot uses
another model provider. Neither uploaded ZIP contains a DeepSeek reference.
Base44, Lovable and Bolt in the public description are migration sources and are
the likely trigger, though the finding does not identify a matched phrase.
The browser could not be reinspected after the owner's correction because the
Mac was locked; this explanation refers to the captured finding above.

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

### Seven current route differences

| V1 route | Context |
| --- | --- |
| `GET /api/v1/onboarding/unsubscribe` | Signed email unsubscribe link, not a general agent action. |
| `POST /api/v1/mcp/client-connections` | Connection registration/control plane; not an end-user business tool. |
| `POST /api/v1/migrations/{}/jobs/{}/provide-base44-secrets` | Deliberate credential boundary. Secret values are entered in the dashboard; MCP exposes secret names/state and the browser handoff. Do not create a credential-taking tool to close this row. |
| `POST /api/v1/public/site-scans` | Anonymous browser onboarding/anti-abuse flow. MCP starts owned checks through `POST /api/v1/site-scans`. |
| `GET /api/v1/public/site-scans/{}` | Anonymous result flow. MCP reads owned results through `GET /api/v1/site-scans/{id}`. |
| `GET /api/v1/public/site-scans/{}/screenshot` | Browser screenshot response. A future image tool needs a tested media/authorization contract; existing result reads do not establish screenshot parity. |
| `POST /api/v1/public/site-scans/{}/report` | Browser report delivery/consent flow. Adding agent report delivery requires its own input/authorization contract. |

These checks establish route coverage. Request fields, response fields, permission behavior and
confirmation semantics remain the responsibility of the focused contract tests. A planned
`GET /api/v1/pricing` that has not been implemented is still work in the app's
`2026-10-16-plan-facts-single-source.md`; route discovery cannot infer an endpoint that does not exist.

## Added locally

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

- Linking a connected project to a stack or an existing deployment remains a separate browser-only
  capability. Project creation/deletion, collaboration, delivery and pipeline administration are
  outside these two requested gaps. This change does not claim complete dashboard parity.
- Credential intake is deliberately different. V1's Base44-secret endpoint exists for API-key
  callers, while delegated MCP rejects credential material. MCP sends the user to the dashboard.
  Do not restore `provide_base44_secrets` or the old `scan_deployed_url` key-extraction contract.
- Migration histories, source inspection, handoff reports, AWS/Cloudflare ownership choices and
  Supabase provisioning already have MCP tools. A simple text comparison can falsely report gaps
  for their parameterized paths, so route counts alone do not establish parity.

This check does not claim every dashboard operation, request field or response field has parity.

## Submission maintenance

`chatgpt-app-submission.json` now covers all 112 local runtime tools with explicit annotations and
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
