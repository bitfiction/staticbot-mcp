# Structured logging

`src/log.ts` — one JSON object per line, to stderr always and to a file when `MCP_LOG_FILE` is set.
Consumed by `src/hosted/*` today; the stdio entrypoint can adopt it unchanged (it already writes to
stderr, which is the whole reason the sink is stderr).

## Why it exists

Before this, the hosted server wrote to stderr in exactly four places — a startup banner, a SIGTERM
notice, and two failure-only error lines. On a healthy day where customers connected and called tools
successfully, it wrote **nothing**, so a customer reporting "the agent did something weird" could not
be reconstructed at all.

The proximate cause for adding it: the node's own log rotation is ~25MB per container
(`container-log-max-size` ~10MB × ~5 files), and DOKS sets those kubelet flags itself with no way to
override them. Anything written only to stderr is gone within hours of a busy day. The file sink
lives on a PersistentVolumeClaim for that reason.

## One choke point, covering all 63 tools

Every tool in `src/tools/*.ts` registers through `registerApiTool`, and every handler makes **exactly
one** `apiFetch` call — the two counts match 1:1 across all eleven files. That makes `apiFetch` in
`src/hosted/context.ts` a complete instrumentation point: logging there covers 100% of tool calls
with no per-tool change, and the authenticated actor is already in lexical scope.

If a future tool ever calls `fetch` directly instead of going through the context, it will be
invisible in the logs. Nothing enforces the pattern; that invariant is the thing to check when a tool
mysteriously produces no `mcp.tool` line.

## Redaction — the rules

Three real leaks drove the design. Two of those tool arguments have since been removed outright —
secrets no longer travel as tool arguments at all — but the reasoning is why the redaction is shaped
the way it is, and the third leak is still live:

| Where | What | Status |
|---|---|---|
| `src/tools/gates.ts` | `secrets: z.record(z.string())` — secret name → customer API key value | removed; the gate is resolved in the dashboard |
| `src/tools/migrations.ts` | `firebaseServiceAccountJson` — a full service-account key | removed; Firebase migrations are created in the dashboard |
| `src/tools/migrations.ts` `download_package` | returns the zip password, and its tool description promises customers it is "shown only here, **never logged**" | **live** |

From those:

1. **Arguments are redacted by key name, recursively.** `SECRET_KEY_PATTERN` lives in
   `secret-policy.ts` and is shared with the tool-argument guard — one definition, because two copies
   of "which names mean credential" drift. It matches substrings, not exact names, since the schemas
   are not uniform (`apiKey`, `api_key`, `SERVICE_ACCOUNT_JSON`). Over-redacting costs a little
   debuggability; under-redacting writes a customer's API key into a file that may get shipped off the
   cluster.
2. **A matched key drops its whole subtree.** `redact` returns the marker for the entire value, not
   for matched leaves, because a free-form map's keys are arbitrary secret names that no pattern can
   enumerate — matching the *parent* is the only thing that works.

   **This is now defence in depth, not the primary control.** No tool accepts credential material any
   more: `provide_base44_secrets` is gone, `firebaseServiceAccountJson` is gone, and the two
   `configOverrides` maps reject secret-looking keys outright (`secret-policy.ts`). Keep the redaction
   regardless — Staticbot's own API responses and error messages still pass through here, and they are
   not written by this server.
3. **Success response bodies are never logged.** This is what keeps the `download_package` promise:
   the password only ever arrives with a 200. `responseBytes` is logged instead, which is enough to
   tell a large payload from a small one.
4. **Error bodies *are* logged**, because they are what makes a failure diagnosable, and they only
   arrive on a non-2xx. They are string-scrubbed first: a validation error quotes the offending value
   back, so an API error about a value this server merely relayed would otherwise leak through the
   reason string even though the argument itself was redacted. `collectSecretValues` pulls the sensitive leaves out of the
   request and `scrubSecrets` removes them from the text. Values under 6 characters are skipped, since
   shorter strings match ordinary prose.

`scripts/check-redaction.mjs` (run by `npm test`) asserts each of these. It exists because this is the
one property of the change that **fails silently**: a regression breaks no build, fails no request,
and shows up only as credentials quietly appearing in a log file.

## File sink behaviour

- Filename is `<YYYY-MM-DD>-<hostname>.log`. The date makes retention a matter of deleting whole
  files; the hostname keeps concurrent replicas from interleaving into one file, which is
  indistinguishable from corruption when read back.
- `MCP_LOG_FILE` is the base path; the date and hostname are inserted (`/var/log/staticbot/mcp.log` →
  `/var/log/staticbot/2026-09-14-<pod>.log`). Retention prunes by the date **in the filename**, not
  mtime, since mtime drifts as soon as anything touches the file. `MCP_LOG_RETENTION_DAYS` defaults to 14.
- **`logEvent` never throws.** Every call site is on a request path, so a full disk must not become a
  customer-visible outage. A file-sink failure is reported once to stderr and then file logging is
  disabled for that process, so the failure cannot itself become the flood.
- **Never stdout.** That is the stdio transport's JSON-RPC channel; a stray line there corrupts the
  protocol and surfaces as a broken tool call with no error.

## Gotchas

- **Probe traffic must not be logged.** `/healthz` and `/readyz` run every 5s and 20s per replica —
  ~43k requests a day — and would bury everything else while consuming the retention budget.
- **The MCP claim is `ReadWriteOnce`.** If `mcp_replicas` is ever raised above 1 and the replicas land
  on different nodes, the volume will not attach. The hostname in the filename makes co-located
  replicas sane, but the claim itself is the constraint.
- **`uncaughtException`/`unhandledRejection` are handled and then `process.exit(1)`.** The log line is
  the only record of a crash that escaped every handler; exiting matches Node's default, since a
  process in an unknown state is the pod's problem to replace.
- **Truncation is deliberate.** Strings cap at 500 chars, depth at 6. A single oversized argument
  (`configOverrides`, a long description) must not dominate the log or the volume.
