import { toText, type ToolContext } from "../context.js";
import { collectSecretValues, logEvent, redact, scrubSecrets } from "../log.js";
import type { HostedConfig } from "./config.js";
import type { Actor } from "./token-verifier.js";

/**
 * Tool arguments arrive as the JSON string the SDK built from the validated input schema.
 *
 * Returns undefined rather than throwing: an unparseable body means we lose the argument log for
 * that call, which must never be a reason the call itself fails.
 */
function parseJsonBody(body: BodyInit | null | undefined): unknown {
  if (typeof body !== "string") {
    return undefined;
  }
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}

/** Headers Staticbot reads to learn who the service is acting for. Must match McpDelegatedAuthenticationFilter. */
const ACTOR_SUBJECT = "X-Staticbot-Actor-Subject";
const ACTOR_USERNAME = "X-Staticbot-Actor-Username";
const ACTOR_EMAIL = "X-Staticbot-Actor-Email";
const ACTOR_SCOPES = "X-Staticbot-Actor-Scopes";
const ACTOR_IDP = "X-Staticbot-Actor-Idp";
const MCP_OAUTH_CLIENT_ID = "X-Staticbot-Mcp-OAuth-Client-Id";

export interface McpClientInfo {
  name: string;
  version: string;
}

function delegatedHeaders(actor: Actor): Record<string, string> {
  return {
    [ACTOR_SUBJECT]: actor.subject,
    [ACTOR_USERNAME]: actor.username,
    [ACTOR_EMAIL]: actor.email,
    [ACTOR_SCOPES]: actor.scopes.join(" "),
    [MCP_OAUTH_CLIENT_ID]: actor.oauthClientId,
    ...(actor.identityProvider ? { [ACTOR_IDP]: actor.identityProvider } : {}),
  };
}

/**
 * A `ToolContext` scoped to one request and one user.
 *
 * Built per request on purpose. The stdio server can hold a single credential for its lifetime
 * because it serves one user; here a credential that outlived its request would be a credential
 * available to the next user's tools.
 */
export function createDelegatedContext(
  config: HostedConfig,
  actor: Actor,
  serviceToken: () => Promise<string>,
): ToolContext {
  return {
    toText,
    async apiFetch(path: string, options: RequestInit = {}): Promise<unknown> {
      const method = options.method ?? "GET";
      const startedAt = Date.now();

      // The argument object is the only record of what the customer's agent asked for, and every
      // tool reaches the API through here — 59 of them, one call each — so this single line covers
      // the whole surface without touching a single tool definition.
      const requestArgs = parseJsonBody(options.body);
      const secrets = collectSecretValues(requestArgs);

      const logCall = (
        outcome: "ok" | "error",
        status: number | null,
        detail: Record<string, unknown>,
      ): void => {
        logEvent(
          "mcp.tool",
          {
            actor: actor.email,
            oauthClientId: actor.oauthClientId,
            method,
            path,
            status,
            outcome,
            durationMs: Date.now() - startedAt,
            ...(requestArgs === undefined ? {} : { args: redact(requestArgs) }),
            ...detail,
          },
          outcome === "ok" ? "info" : "warn",
        );
      };

      let res: Response;
      try {
        res = await fetch(`${config.apiUrl}${path}`, {
          ...options,
          headers: {
            "Authorization": `Bearer ${await serviceToken()}`,
            "Content-Type": "application/json",
            ...delegatedHeaders(actor),
            ...(options.headers ?? {}),
          },
        });
      } catch (error) {
        // A transport failure never reaches the !res.ok branch, so without this the one class of
        // failure that is invisible to Staticbot's own logs would also be invisible here.
        logCall("error", null, { error: scrubSecrets((error as Error).message, secrets) });
        throw error;
      }

      const text = await res.text();

      if (!res.ok) {
        // Staticbot answers 403 with a reason ("Delegated scope 'staticbot:write' required",
        // "Unknown Staticbot account for the asserted actor"). Surface it verbatim: the model can act
        // on that, where a bare status code just produces a retry loop.
        //
        // Scrubbed first, because "verbatim" includes any secret the API quoted back — a rejected
        // provide_base44_secrets call echoes the offending value into the reason string.
        const message = scrubSecrets(`HTTP ${res.status} ${res.statusText}: ${text}`, secrets);
        logCall("error", res.status, { error: message });
        throw new Error(message);
      }

      // The response body is deliberately not logged. download_package returns the migration
      // package password and its tool description promises the customer it is "shown only here,
      // never logged" — a promise a blanket success-body log would break. Error bodies above are a
      // different matter: the password only ever arrives with a 200.
      logCall("ok", res.status, { responseBytes: text.length });

      return text ? JSON.parse(text) : null;
    },
  };
}

/**
 * Persists one successful MCP initialization in Staticbot's own database.
 *
 * `oauthClientId` is authenticated provenance from the access token. `clientInfo` is deliberately
 * stored as a human-readable claim: MCP requires it during initialize, but does not authenticate it.
 */
export async function recordClientConnection(
  config: HostedConfig,
  actor: Actor,
  serviceToken: () => Promise<string>,
  clientInfo: McpClientInfo,
): Promise<void> {
  const res = await fetch(`${config.apiUrl}/api/v1/mcp/client-connections`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${await serviceToken()}`,
      "Content-Type": "application/json",
      ...delegatedHeaders(actor),
    },
    body: JSON.stringify({ clientName: clientInfo.name, clientVersion: clientInfo.version }),
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}: ${await res.text()}`);
  }
}
