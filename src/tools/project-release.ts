import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ToolContext } from "../context.js";
import { apiToolResult, registerApiTool } from "../server/api-tool.js";

/**
 * A connected project's path to production: which sign-in page its live site shows, and the release pipeline
 * (preview → production) with its sign-off. Each decision tool names exactly what the user approved, so a state
 * that changed in between answers 409 instead of being decided on a stale approval.
 */
export function registerProjectReleaseTools(server: McpServer, { apiFetch, toText }: ToolContext): void {
  registerApiTool(server,
    "get_sign_in_page",
    "For a migrated Base44 app: which page its site shows at /login. `offered` says whether the app's own sign-in " +
      "page can be used here; `choice` is APP, STATICBOT or null; `decisionRequired` means the first go-live must " +
      "wait for a choice. `options` describe both pages for the app's users, including whether \"Continue with " +
      "Google\" works right now, and `previewLinks` open both pages on the preview to compare. Show the options " +
      "verbatim before asking the user to choose. Read-only.",
    { id: z.string().uuid().describe("Connected project ID") },
    { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    async ({ id }) => apiToolResult(await apiFetch(`/api/v1/connected-projects/${id}/sign-in-page`), toText),
  );

  registerApiTool(server,
    "set_sign_in_page",
    "Choose the page the app's site shows at /login: APP (the app's own design; imported users set a password " +
      "with \"Forgot password?\" the first time) or STATICBOT (email sign-in code, works for every existing user). " +
      "Read get_sign_in_page first, present both options, and pass confirmed=true only after the user chose. It " +
      "takes effect with each deployment's next build; nothing is redeployed by this call. A 409 " +
      "SIGN_IN_CHOICE_UNAVAILABLE means the app has no own page that works here.",
    {
      id: z.string().uuid().describe("Connected project ID"),
      choice: z.enum(["APP", "STATICBOT"]).describe("The page the user chose"),
      confirmed: z.literal(true).describe("True only after the user chose this page"),
    },
    { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    async ({ id, choice, confirmed }) => apiToolResult(await apiFetch(`/api/v1/connected-projects/${id}/sign-in-page`, {
      method: "PUT", body: JSON.stringify({ choice, confirmed }),
    }), toText),
  );

  registerApiTool(server,
    "get_release_pipeline",
    "Read a connected project's release pipeline: stages in order (preview first, production last), what each " +
      "serves and its status, and its gate: AUTO (green previews go live by themselves) or MANUAL (a release " +
      "waits for sign-off). A MANUAL stage awaiting sign-off carries `pendingCommitSha`, the commit a sign-off " +
      "would release; `canApprove`/`canReject` already reflect the caller's role. `firstGoLiveNeedsLaunch` means " +
      "production has never launched: going live is the hosting launch in the dashboard, not a sign-off. Read-only.",
    { id: z.string().uuid().describe("Connected project ID") },
    { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    async ({ id }) => apiToolResult(await apiFetch(`/api/v1/connected-projects/${id}/pipeline`), toText),
  );

  const signOff = {
    id: z.string().uuid().describe("Connected project ID"),
    stageId: z.string().uuid().describe("Stage ID from get_release_pipeline"),
    confirmed: z.literal(true).describe("True only after the user decided on this exact release"),
    expectedCommitSha: z.string().min(1).describe("The stage's pendingCommitSha the user saw, copied unchanged"),
  };

  registerApiTool(server,
    "approve_release",
    "Sign off the release awaiting approval on a MANUAL stage: its pending commit is deployed to that stage (for " +
      "production: the live site). Read get_release_pipeline first, tell the user the stage and the pending commit, " +
      "and approve only after an explicit yes. outcome DEFERRED means nothing was deployed (a deploy is in flight " +
      "or a newer push superseded the commit); a 409 means the stage now awaits another commit. Either way read " +
      "the pipeline again and ask again; never retry blindly. Follow the deployment with get_deployment.",
    signOff,
    { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    async ({ id, stageId, ...body }) => apiToolResult(await apiFetch(
      `/api/v1/connected-projects/${id}/pipeline/stages/${stageId}/approve`, {
        method: "POST", body: JSON.stringify(body),
      }), toText),
  );

  registerApiTool(server,
    "reject_release",
    "Reject the release awaiting approval on a stage: the pending commit is dropped and what the stage serves is " +
      "unchanged. A later push arms a new release. Confirm the stage and pending commit with the user first; a 409 " +
      "means the stage now awaits another commit.",
    signOff,
    { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    async ({ id, stageId, ...body }) => apiToolResult(await apiFetch(
      `/api/v1/connected-projects/${id}/pipeline/stages/${stageId}/reject`, {
        method: "POST", body: JSON.stringify(body),
      }), toText),
  );

  registerApiTool(server,
    "set_release_gate",
    "Switch a pipeline stage between AUTO and MANUAL. AUTO on production means every green preview of the live " +
      "branch goes live without anyone approving it; MANUAL makes each release wait for approve_release. Explain " +
      "that consequence and pass confirmed=true only after the user chose.",
    {
      id: z.string().uuid().describe("Connected project ID"),
      stageId: z.string().uuid().describe("Stage ID from get_release_pipeline"),
      gate: z.enum(["AUTO", "MANUAL"]).describe("The gate the user chose"),
      confirmed: z.literal(true).describe("True only after the user chose this gate"),
    },
    { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    async ({ id, stageId, gate, confirmed }) => apiToolResult(await apiFetch(
      `/api/v1/connected-projects/${id}/pipeline/stages/${stageId}/gate`, {
        method: "PATCH", body: JSON.stringify({ gate, confirmed }),
      }), toText),
  );
}
