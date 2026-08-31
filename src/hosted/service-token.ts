import type { HostedConfig } from "./config.js";

/** Refresh this long before expiry, so a token never expires mid-request. */
const EXPIRY_MARGIN_MS = 30_000;

/**
 * Supplies the service-account token the hosted server authenticates to the Staticbot API with.
 *
 * This is a second, separate identity from the caller's. The user's token is verified at this
 * server's boundary and stops there; Staticbot is called as `staticbot_mcp_service` with the actor
 * asserted alongside. Forwarding the user's token instead would be OAuth token passthrough — it
 * carries the wrong audience and would let anything holding it act as the user against an API that
 * never authenticated them.
 */
export function createServiceTokenProvider(config: HostedConfig) {
  let cached: { token: string; expiresAt: number } | null = null;
  let inFlight: Promise<string> | null = null;

  async function fetchToken(): Promise<string> {
    const res = await fetch(`${config.issuer}/protocol/openid-connect/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: config.serviceClientId,
        client_secret: config.serviceClientSecret,
      }),
    });

    if (!res.ok) {
      throw new Error(`Service token request failed: HTTP ${res.status} ${await res.text()}`);
    }

    const body = (await res.json()) as { access_token: string; expires_in: number };
    cached = {
      token: body.access_token,
      expiresAt: Date.now() + body.expires_in * 1000 - EXPIRY_MARGIN_MS,
    };
    return cached.token;
  }

  return async function serviceToken(): Promise<string> {
    if (cached && Date.now() < cached.expiresAt) {
      return cached.token;
    }
    // Collapse concurrent refreshes: under load every in-flight request would otherwise mint its own
    // token, and Keycloak would see a burst of grants for one expiry.
    inFlight ??= fetchToken().finally(() => {
      inFlight = null;
    });
    return inFlight;
  };
}
