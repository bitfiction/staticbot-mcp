/**
 * The one rule this server enforces about credential material: it never travels as a tool argument.
 *
 * A tool call's arguments are model output — the model has to emit the JSON for the call to exist at
 * all. So a secret passed to a tool was, by construction, in the model's context and in the client
 * provider's transcript before Staticbot ever saw it. That is a property of the transport, not of
 * any particular client, and no amount of careful tool-description prose changes it.
 *
 * Hence: no tool here accepts a secret, and the two free-form `configOverrides` maps — the only
 * remaining inputs whose shape could smuggle one — are checked rather than merely documented.
 * Staticbot's API enforces the same rule independently for hosted-MCP credentials
 * (`SecretIntakeGuard`, 403 `SECRET_INTAKE_REFUSED`); this is the client-side half, and it exists so
 * the caller gets a useful answer instead of a bare refusal from the far end.
 *
 * Shell-capable clients are deliberately *not* covered by this file. They can read a value from a
 * file or an environment variable and never put it in model output, so they keep using the API
 * directly — see `skills/staticbot/SKILL.md`.
 */

/**
 * Keys whose value is assumed to be credential material, matched case-insensitively as a substring.
 *
 * Substring rather than exact match because the spellings are not uniform and never will be:
 * `apiKey`, `api_key`, `SERVICE_ACCOUNT_JSON` and `stripe_secret` all have to be caught. Over-
 * matching costs a rejected config key the user can rename or set in the dashboard; under-matching
 * puts a customer credential into a transcript.
 */
export const SECRET_KEY_PATTERN =
  /secret|password|passwd|token|api[-_]?key|credential|private[-_]?key|service[-_]?account/i;

/**
 * Rejects config keys that look like credential names.
 *
 * `configOverrides` is a `Record<string, string>` on both `create_migration` and `create_stack`, and
 * its description has always said "non-secret". A description is a request; this is the check. It
 * returns the offending keys rather than a boolean so the error can name them — an agent told only
 * "rejected" retries with the same payload.
 */
export function findSecretLikeKeys(config: Record<string, string> | undefined): string[] {
  if (!config) {
    return [];
  }
  return Object.keys(config).filter((key) => SECRET_KEY_PATTERN.test(key));
}

/**
 * The refusal an agent sees, written to be acted on rather than merely reported.
 *
 * It names the keys, says where the value actually belongs, and closes the obvious workaround — an
 * agent that is told "don't send secrets" but not "don't ask for them" will cheerfully ask the user
 * to paste one into the chat and then try a different field.
 */
export function secretLikeKeysError(keys: string[], dashboardUrl: string): { error: string } {
  return {
    error:
      `configOverrides rejected: ${keys.join(", ")} ${keys.length === 1 ? "looks" : "look"} like ` +
      `credential names, and this connection cannot carry credential values — tool arguments pass ` +
      `through the model's context and the transcript. Do not ask the user for these values here, ` +
      `and do not accept them if offered. Connected integrations supply provider credentials ` +
      `automatically; anything else is set by the user at ${dashboardUrl}. If the key is genuinely ` +
      `not a secret (a public URL or a feature flag), rename it so it does not read as one.`,
  };
}
