import { appendFileSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { hostname } from "node:os";
import { dirname, join } from "node:path";

/**
 * Structured logging for the MCP server.
 *
 * One JSON object per line, because the alternative — prose — is unqueryable the moment you need it.
 * A log survives exactly as long as someone can grep it, and `grep '"tool":"create_migration"'` is
 * a question you can ask of JSON lines and not of formatted text.
 *
 * Two sinks, deliberately:
 *   - **stderr**, always. Kubernetes captures it, so `kubectl logs` keeps working and a local run
 *     prints to the terminal.
 *   - **a file**, when `MCP_LOG_FILE` is set. The node's own rotation is ~25MB per container and
 *     DOKS does not let us raise it, so anything written only to stderr is gone within hours of a
 *     busy day. The file lives on a PersistentVolumeClaim.
 *
 * **Never stdout.** The stdio transport uses stdout as its JSON-RPC channel; a stray log line there
 * corrupts the protocol and surfaces to the user as a broken tool call with no error.
 */

export type LogLevel = "info" | "warn" | "error";

/** Substituted for any value whose key looks like it carries a credential. */
const REDACTED = "[redacted]";

/**
 * Keys whose *value* is never loggable, matched case-insensitively as a substring.
 *
 * Substring rather than exact match because the names are not uniform across the tool schemas:
 * `apiKey`, `api_key`, `firebaseServiceAccountJson` and `secrets` all have to be caught, and new
 * tools will invent new spellings. Over-redacting costs a little debuggability; under-redacting
 * writes a customer's Base44 API key into a log file that then gets shipped somewhere.
 */
const SECRET_KEY_PATTERN =
  /secret|password|passwd|token|api[-_]?key|credential|private[-_]?key|service[-_]?account/i;

/** Strings are capped so one oversized argument cannot dominate the log or the volume. */
const MAX_STRING_LENGTH = 500;

/** Guards against a cyclic or pathologically deep structure turning redaction into a hang. */
const MAX_DEPTH = 6;

function truncate(value: string): string {
  return value.length > MAX_STRING_LENGTH ? `${value.slice(0, MAX_STRING_LENGTH)}…[truncated]` : value;
}

/**
 * Replaces sensitive values with a marker, recursively.
 *
 * Recursion is the point. A top-level-only pass would still log the contents of
 * `provide_base44_secrets`'s `secrets` argument, whose keys are arbitrary secret names that no
 * name-pattern could enumerate — so the whole subtree under a matched key is dropped, not just the
 * matched name.
 */
export function redact(value: unknown, depth = 0): unknown {
  if (typeof value === "string") {
    return truncate(value);
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (depth >= MAX_DEPTH) {
    return "[depth-limit]";
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redact(entry, depth + 1));
  }

  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    result[key] = SECRET_KEY_PATTERN.test(key) ? REDACTED : redact(entry, depth + 1);
  }
  return result;
}

/**
 * Collects the leaf values that sit under a sensitive key.
 *
 * Used to scrub free text — an error message is prose, so key-based redaction cannot reach into it,
 * and Staticbot's validation errors quote the offending value back. A rejected
 * `provide_base44_secrets` call would otherwise put the API key into the log through the error
 * message even though the argument itself was redacted.
 */
export function collectSecretValues(value: unknown, depth = 0): string[] {
  if (value === null || typeof value !== "object" || depth >= MAX_DEPTH) {
    return [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectSecretValues(entry, depth + 1));
  }

  const found: string[] = [];
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_KEY_PATTERN.test(key)) {
      // Take the leaves: the value may be a map of secret name to secret value.
      if (typeof entry === "string" && entry.length > 0) {
        found.push(entry);
      } else if (entry && typeof entry === "object") {
        for (const nested of Object.values(entry as Record<string, unknown>)) {
          if (typeof nested === "string" && nested.length > 0) {
            found.push(nested);
          }
        }
      }
    } else {
      found.push(...collectSecretValues(entry, depth + 1));
    }
  }
  return found;
}

/** Replaces every occurrence of the given secrets in free text. */
export function scrubSecrets(text: string, secrets: string[]): string {
  let scrubbed = text;
  for (const secret of secrets) {
    // Short values would match ordinary prose; a one-character "secret" is not worth the noise.
    if (secret.length >= 6) {
      scrubbed = scrubbed.split(secret).join(REDACTED);
    }
  }
  return truncate(scrubbed);
}

/**
 * The file a log line belongs in, or null when file logging is off.
 *
 * Date *and* hostname are in the name. The date is what makes retention a matter of deleting whole
 * files rather than rewriting one that grows without bound. The hostname keeps concurrent writers
 * apart: replicas share this claim and would otherwise interleave into a single file, which is
 * indistinguishable from corruption when you are reading it back.
 */
function logFileFor(date: Date): string | null {
  const configured = process.env.MCP_LOG_FILE?.trim();
  if (!configured) {
    return null;
  }
  const day = date.toISOString().slice(0, 10);
  const directory = dirname(configured);
  const name = `${day}-${hostname()}.log`;
  return join(directory, name);
}

let fileLoggingBroken = false;
let prunedForDirectory: string | null = null;

/**
 * Deletes log files older than the retention window, once per process per directory.
 *
 * Age is taken from the filename rather than mtime: the name is the date the lines belong to, and
 * mtime drifts the moment anything touches the file.
 */
function pruneExpiredFiles(directory: string): void {
  if (prunedForDirectory === directory) {
    return;
  }
  prunedForDirectory = directory;

  const retentionDays = Number(process.env.MCP_LOG_RETENTION_DAYS ?? 14);
  if (!Number.isFinite(retentionDays) || retentionDays <= 0) {
    return;
  }
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  for (const entry of readdirSync(directory)) {
    const match = /^(\d{4}-\d{2}-\d{2})-.*\.log$/.exec(entry);
    if (match && match[1] < cutoff) {
      rmSync(join(directory, entry), { force: true });
    }
  }
}

/**
 * Emits one event.
 *
 * Deliberately infallible. Every call site is on a request path, and a full disk or an unwritable
 * mount would otherwise turn a logging problem into a customer-visible outage — the same reasoning
 * that makes `recordClientConnection` best-effort. A failure to log is reported once, to stderr,
 * and then stops being reported so it cannot itself become the flood.
 */
export function logEvent(
  event: string,
  fields: Record<string, unknown> = {},
  level: LogLevel = "info",
): void {
  const now = new Date();
  const line = JSON.stringify({
    ts: now.toISOString(),
    level,
    event,
    instance: hostname(),
    ...fields,
  });

  process.stderr.write(`${line}\n`);

  const file = logFileFor(now);
  if (!file || fileLoggingBroken) {
    return;
  }
  try {
    mkdirSync(dirname(file), { recursive: true });
    pruneExpiredFiles(dirname(file));
    appendFileSync(file, `${line}\n`);
  } catch (error) {
    fileLoggingBroken = true;
    process.stderr.write(
      `${JSON.stringify({
        ts: now.toISOString(),
        level: "error",
        event: "log.file_failed",
        instance: hostname(),
        error: (error as Error).message,
        note: "file logging disabled for this process; stderr continues",
      })}\n`,
    );
  }
}

/**
 * Reports the current log file and its size, so a deploy can be confirmed to be writing where
 * someone later expects to read. Cheap enough to call at startup.
 */
export function describeLogTarget(): Record<string, unknown> {
  const file = logFileFor(new Date());
  if (!file) {
    return { fileLogging: "disabled" };
  }
  try {
    return { fileLogging: "enabled", logFile: file, logFileBytes: statSync(file).size };
  } catch {
    return { fileLogging: "enabled", logFile: file, logFileBytes: 0 };
  }
}
