/**
 * Everything a tool needs from its host, supplied per call rather than closed over.
 *
 * This is the seam that lets one tool registry serve two very different servers. The stdio server
 * holds a single API key for the whole process; a hosted server has no ambient credential at all —
 * each request carries its own user, so `apiFetch` must be built per request. Anything a tool needs
 * that varies by caller belongs here.
 */
export interface ToolContext {
  /** Calls the Staticbot API with whatever credential this invocation is entitled to. */
  apiFetch(path: string, options?: RequestInit): Promise<unknown>;
  /** Renders a payload for the model. */
  toText(data: unknown): string;
}

export function toText(data: unknown): string {
  return JSON.stringify(data, null, 2);
}

/**
 * Context for the stdio server: one long-lived API key for the whole process.
 *
 * The hosted server deliberately does NOT reuse this — it mints a context per request from the
 * caller's validated OAuth identity, so a credential can never outlive the request that presented it.
 */
export function createApiKeyContext(apiUrl: string, apiKey: string): ToolContext {
  return {
    toText,
    async apiFetch(path: string, options: RequestInit = {}): Promise<unknown> {
      const res = await fetch(`${apiUrl}${path}`, {
        ...options,
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          ...(options.headers ?? {}),
        },
      });

      const text = await res.text();

      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText}: ${text}`);
      }

      return text ? JSON.parse(text) : null;
    },
  };
}
