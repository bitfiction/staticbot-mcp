import assert from "node:assert/strict";

import { collectSecretValues, logEvent, redact, scrubSecrets } from "../dist/log.js";

/**
 * Guards the one property of the logging change that fails silently.
 *
 * A redaction regression does not break a build, fail a request, or show up in any test that
 * exercises behaviour — it just quietly starts writing customer credentials into a log file that is
 * read by whoever is debugging, and possibly shipped off the cluster. There is no unit-test
 * framework in this repo, so this runs as a script from `npm test`, the same way the other checks do.
 *
 * Values below are deliberately long enough to exercise scrubSecrets' minimum-length rule.
 */

const BASE44_KEY = "b44_live_9f3c1a7e5d2b8046a1c9e7f3";
const FIREBASE_SA = '{"private_key":"-----BEGIN PRIVATE KEY-----MIIEvQIBADANBgkq"}';
const PACKAGE_PASSWORD = "Zx7Kq2mNp4Rt8Vw1";

// A representative create_migration argument set: one plain field, one secret-bearing field.
const args = {
  sourceType: "BASE44_SUPABASE",
  firebaseServiceAccountJson: FIREBASE_SA,
  configOverrides: { SITE_NAME: "customer-app" },
};

const redacted = redact(args);
assert.equal(redacted.firebaseServiceAccountJson, "[redacted]", "service-account JSON must be dropped");
assert.equal(redacted.sourceType, "BASE44_SUPABASE", "non-sensitive values must survive");
assert.deepEqual(redacted.configOverrides, { SITE_NAME: "customer-app" });

// provide_base44_secrets takes `secrets` as a free-form map whose keys are arbitrary secret names,
// so nothing about the key names inside can be matched — the whole subtree has to go.
const secretsArgs = { migrationId: "2f8a...", secrets: { STRIPE_KEY: BASE44_KEY, OTHER: "another-value" } };
const redactedSecrets = redact(secretsArgs);
assert.equal(redactedSecrets.secrets, "[redacted]", "the entire secrets map must be dropped, not just matched keys");
assert.equal(redactedSecrets.migrationId, "2f8a...", "sibling fields must survive");

// Nested containers have to be walked, or a secret one level down is logged in the clear.
assert.deepEqual(redact({ outer: { accessToken: "abcdef123456" } }), { outer: { accessToken: "[redacted]" } });
assert.deepEqual(redact({ list: [{ password: "hunter2000" }] }), { list: [{ password: "[redacted]" }] });

// Error bodies are free text, so key matching cannot reach into them. Staticbot's validation errors
// quote the offending value back, which is how a rejected secret submission would otherwise leak.
const collected = collectSecretValues({ ...args, ...secretsArgs });
assert.ok(collected.includes(BASE44_KEY), "secret values must be collected for text scrubbing");
assert.ok(collected.includes(FIREBASE_SA), "a secret-bearing object's leaves must be collected");

const scrubbed = scrubSecrets(`HTTP 400 Bad Request: invalid key ${BASE44_KEY}`, collected);
assert.ok(!scrubbed.includes(BASE44_KEY), "secrets must not survive scrubbing of an error message");
assert.ok(scrubbed.includes("HTTP 400 Bad Request"), "the diagnosable part of the message must survive");

// The download_package password arrives in a response body, never in a request argument, and no
// success response body is ever logged — this asserts the scrubber would catch it regardless.
assert.ok(!scrubSecrets(`password: ${PACKAGE_PASSWORD}`, [PACKAGE_PASSWORD]).includes(PACKAGE_PASSWORD));

// Truncation keeps one oversized argument from dominating the log or the volume.
assert.ok(redact({ description: "x".repeat(5000) }).description.length < 600, "long strings must be capped");

// Cyclic input must terminate rather than hang the request that is being logged.
const cyclic = { name: "root" };
cyclic.self = cyclic;
assert.doesNotThrow(() => JSON.stringify(redact(cyclic)), "cyclic structures must not hang redaction");

// ---------------------------------------------------------------------------
// logEvent's "never throws" contract
//
// Every call site is on a request path, so an exception escaping here converts a logging problem
// into a failed customer request. Three concrete ways that could happen, all of which did before
// serialization and the stderr write were brought inside the guard.
// ---------------------------------------------------------------------------

assert.doesNotThrow(() => logEvent("probe.bigint", { value: 1n }), "a BigInt field must not escape logEvent");
assert.doesNotThrow(() => logEvent("probe.circular", { cyclic }), "a circular field must not escape logEvent");
assert.doesNotThrow(
  () => logEvent("probe.getter", { get boom() { throw new Error("getter threw"); } }),
  "a throwing getter must not escape logEvent",
);

// stderr is a stream, and streams fail: EPIPE on a reader that has gone away raises synchronously.
const realWrite = process.stderr.write;
process.stderr.write = () => { throw new Error("EPIPE"); };
try {
  assert.doesNotThrow(() => logEvent("probe.stderr", { ok: true }), "a throwing stderr must not escape logEvent");
} finally {
  process.stderr.write = realWrite;
}

console.log("MCP redaction check passed (redaction + logEvent non-throwing contract)");
