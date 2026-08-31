import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

import type { HostedConfig } from "./config.js";

/** The end user a request acts for, taken only from a verified token. */
export interface Actor {
  subject: string;
  username: string;
  email: string;
  scopes: string[];
  identityProvider?: string;
}

export class TokenVerificationError extends Error {}

/**
 * Verifies the caller's OAuth access token against the Keycloak realm.
 *
 * The audience check is the load-bearing part. A token minted for some other Staticbot audience —
 * the API, the dashboard — must not be usable here, and vice versa: this server's tokens are never
 * forwarded to the Staticbot API, because passing a token issued for one resource to another is the
 * confused-deputy problem the MCP authorization spec exists to prevent.
 */
export function createTokenVerifier(config: HostedConfig) {
  // Caches keys and refetches on unknown kid, so a Keycloak key rotation does not need a restart.
  const jwks = createRemoteJWKSet(new URL(`${config.issuer}/protocol/openid-connect/certs`));

  return async function verify(token: string): Promise<Actor> {
    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(token, jwks, {
        issuer: config.issuer,
        audience: config.mcpResource,
      }));
    } catch (cause) {
      throw new TokenVerificationError(`Token rejected: ${(cause as Error).message}`);
    }

    const subject = payload.sub;
    const username = (payload.preferred_username ?? payload.email) as string | undefined;
    const email = payload.email as string | undefined;

    if (!subject || !username || !email) {
      // Staticbot needs all three to resolve or create the account; a token without them is
      // well-formed but unusable, and failing here beats failing deeper with a vaguer message.
      throw new TokenVerificationError(
        "Token is missing sub, preferred_username or email. Check the client's scopes include profile and email.",
      );
    }

    return {
      subject,
      username,
      email,
      scopes: typeof payload.scope === "string" ? payload.scope.split(/\s+/).filter(Boolean) : [],
      identityProvider: payload.identity_provider as string | undefined,
    };
  };
}
