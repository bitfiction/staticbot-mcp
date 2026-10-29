import assert from "node:assert/strict";
import { once } from "node:events";
import { test } from "node:test";
import { loadConfig } from "../dist/hosted/config.js";
import { createHostedServer } from "../dist/hosted/http.js";

const config = {
  mcpResource: "https://mcp.example.invalid/mcp",
  issuer: "https://auth.example.invalid/realm",
  jwksUrl: "https://auth.example.invalid/certs",
  apiUrl: "https://api.example.invalid",
  serviceClientId: "test-service",
  serviceClientSecret: "test-only",
  port: 0,
};
async function withServer(overrides, check) {
  const server = createHostedServer({ ...config, ...overrides });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    await check(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test("configured ownership proof is exact public text and does not open MCP access", async () => {
  const token = "portal-Test_Proof123";
  await withServer({ openAiAppsChallenge: token }, async (base) => {
    const proof = await fetch(`${base}/.well-known/openai-apps-challenge`);
    assert.equal(proof.status, 200);
    assert.equal(proof.headers.get("content-type"), "text/plain; charset=utf-8");
    assert.equal(proof.headers.get("cache-control"), "no-store");
    assert.equal(await proof.text(), token);
    const head = await fetch(`${base}/.well-known/openai-apps-challenge`, { method: "HEAD" });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), "");
    const post = await fetch(`${base}/.well-known/openai-apps-challenge`, { method: "POST" });
    assert.equal(post.status, 404);
    const protectedResponse = await fetch(`${base}/mcp`, { method: "POST" });
    assert.equal(protectedResponse.status, 401);
    assert.match(protectedResponse.headers.get("www-authenticate"), /resource_metadata=/);
    const discovery = await fetch(`${base}/.well-known/oauth-protected-resource`);
    const metadata = await discovery.json();
    assert.equal(metadata.resource, config.mcpResource);
    assert.deepEqual(metadata.authorization_servers, [config.issuer]);
    assert.deepEqual(metadata.scopes_supported, ["staticbot:read", "staticbot:write"]);
  });
});

test("unconfigured ownership proof remains unavailable while health probes work", async () => {
  await withServer({}, async (base) => {
    assert.equal((await fetch(`${base}/.well-known/openai-apps-challenge`)).status, 404);
    for (const path of ["/healthz", "/readyz"]) {
      const response = await fetch(`${base}${path}`);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { status: "ok" });
    }
  });
});

test("configuration refuses multiple verification tokens and never echoes their value", () => {
  const saved = { ...process.env };
  try {
    Object.assign(process.env, {
      KEYCLOAK_ISSUER: config.issuer,
      MCP_RESOURCE: config.mcpResource,
      MCP_SERVICE_CLIENT_ID: config.serviceClientId,
      MCP_SERVICE_CLIENT_SECRET: config.serviceClientSecret,
      OPENAI_APPS_CHALLENGE_TOKEN: "  portal-Test_Proof123\n",
    });
    assert.equal(loadConfig().openAiAppsChallenge, "portal-Test_Proof123");
    process.env.OPENAI_APPS_CHALLENGE_TOKEN = "first-token\nsecond-token";
    assert.throws(() => loadConfig(), (error) => {
      assert.match(error.message, /OPENAI_APPS_CHALLENGE_TOKEN/);
      assert(!error.message.includes("first-token") && !error.message.includes("second-token"));
      return true;
    });
    process.env.OPENAI_APPS_CHALLENGE_TOKEN = " ";
    assert.equal(loadConfig().openAiAppsChallenge, undefined);
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  }
});
