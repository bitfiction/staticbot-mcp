#!/usr/bin/env node
// The package version is repeated in the runtime/plugin metadata and the registry manifest, and
// nothing but this check keeps them together.
// SERVER_VERSION is the one that matters at runtime: it is what an MCP client sees in the initialize
// response, so a stale value misreports the server to every connected agent while every file on disk
// looks fine.
//
// Note the Docker image tag (mcp_image in the control-center tfvars, e.g. 1.8.2-prod) is a SEPARATE
// scheme owned by release.sh. It is not expected to match these and is deliberately not checked here.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const json = (p) => JSON.parse(readFileSync(join(root, p), "utf8"));

const packageJSON = json("package.json");
const packageLockJSON = json("package-lock.json");
const serverJSON = json("server.json");
const expected = packageJSON.version;
const registryPackage = serverJSON.packages?.find(
  (entry) => entry.registryType === "npm" && entry.identifier === packageJSON.name,
);

const found = {
  "package.json": expected,
  "package-lock.json": packageLockJSON.version,
  "package-lock.json root package": packageLockJSON.packages?.[""]?.version,
  ".codex-plugin/plugin.json": json(".codex-plugin/plugin.json").version,
  ".claude-plugin/plugin.json": json(".claude-plugin/plugin.json").version,
  "src/server/create-server.ts": readFileSync(join(root, "src/server/create-server.ts"), "utf8")
    .match(/SERVER_VERSION\s*=\s*"([^"]+)"/)?.[1],
  "server.json": serverJSON.version,
  "server.json npm package": registryPackage?.version,
};

const wrong = Object.entries(found).filter(([, v]) => v !== expected);

if (wrong.length) {
  console.error(`Version mismatch. package.json says ${expected}:`);
  for (const [file, value] of wrong) console.error(`  ${file}: ${value ?? "not found"}`);
  console.error("\nAll listed versions must move together when releasing.");
  process.exit(1);
}

if (packageJSON.mcpName !== serverJSON.name) {
  console.error(
    `Registry name mismatch. package.json mcpName is ${packageJSON.mcpName ?? "missing"}, ` +
      `but server.json name is ${serverJSON.name ?? "missing"}.`,
  );
  process.exit(1);
}

console.log(`Version check passed: ${expected} in all ${Object.keys(found).length} locations`);
