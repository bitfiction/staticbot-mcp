import { toText, type ToolContext } from "../context.js";
import type { HostedConfig } from "./config.js";
import type { Actor } from "./token-verifier.js";

/** Headers Staticbot reads to learn who the service is acting for. Must match McpDelegatedAuthenticationFilter. */
const ACTOR_SUBJECT = "X-Staticbot-Actor-Subject";
const ACTOR_USERNAME = "X-Staticbot-Actor-Username";
const ACTOR_EMAIL = "X-Staticbot-Actor-Email";
const ACTOR_SCOPES = "X-Staticbot-Actor-Scopes";
const ACTOR_IDP = "X-Staticbot-Actor-Idp";

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
      const res = await fetch(`${config.apiUrl}${path}`, {
        ...options,
        headers: {
          "Authorization": `Bearer ${await serviceToken()}`,
          "Content-Type": "application/json",
          [ACTOR_SUBJECT]: actor.subject,
          [ACTOR_USERNAME]: actor.username,
          [ACTOR_EMAIL]: actor.email,
          [ACTOR_SCOPES]: actor.scopes.join(" "),
          ...(actor.identityProvider ? { [ACTOR_IDP]: actor.identityProvider } : {}),
          ...(options.headers ?? {}),
        },
      });

      const text = await res.text();

      if (!res.ok) {
        // Staticbot answers 403 with a reason ("Delegated scope 'staticbot:write' required",
        // "Unknown Staticbot account for the asserted actor"). Surface it verbatim: the model can act
        // on that, where a bare status code just produces a retry loop.
        throw new Error(`HTTP ${res.status} ${res.statusText}: ${text}`);
      }

      return text ? JSON.parse(text) : null;
    },
  };
}
