/** Configuration for the hosted server. Every value is required — none has a safe default. */
export interface HostedConfig {
  /** Canonical OAuth resource identifier. Must match the `aud` of every user token exactly. */
  mcpResource: string;
  /** Keycloak realm issuer, e.g. https://app.staticbot.dev/auth/realms/staticbot */
  issuer: string;
  /**
   * Where to fetch signing keys. Defaults to the issuer's JWKS path and should stay that way in
   * production, where they are the same host.
   *
   * They come apart in local development: a token minted through the browser carries
   * `iss: http://localhost:9080/...`, so the issuer must be exactly that to validate — but a
   * container cannot reach the host's localhost, so the keys have to be fetched over the compose
   * network instead. Validation identity and network route are genuinely different concerns.
   */
  jwksUrl: string;
  /** Staticbot API base, e.g. https://app.staticbot.dev */
  apiUrl: string;
  /** Confidential client the server authenticates to the Staticbot API as. */
  serviceClientId: string;
  serviceClientSecret: string;
  port: number;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(
      `${name} is required. The hosted server has no safe default for it: a wrong issuer or resource ` +
      `silently accepts tokens meant for something else.`,
    );
  }
  return value.trim();
}

export function loadConfig(): HostedConfig {
  const issuer = required("KEYCLOAK_ISSUER");
  return {
    mcpResource: required("MCP_RESOURCE"),
    issuer,
    jwksUrl: process.env.KEYCLOAK_JWKS_URL?.trim() || `${issuer}/protocol/openid-connect/certs`,
    apiUrl: process.env.STATICBOT_API_URL?.trim() || "https://app.staticbot.dev",
    serviceClientId: required("MCP_SERVICE_CLIENT_ID"),
    serviceClientSecret: required("MCP_SERVICE_CLIENT_SECRET"),
    port: Number(process.env.PORT ?? 3000),
  };
}
