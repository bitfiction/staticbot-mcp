import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
assert.equal(process.argv.length, 2, "this builder accepts no arguments");
const readJson = async (name) => JSON.parse(await readFile(path.join(root, name), "utf8"));
const [source, submission, mcp, pkg] = await Promise.all([
  readJson(".codex-plugin/plugin.json"),
  readJson("chatgpt-app-submission.json"),
  readJson("submission/mcp.json"),
  readJson("package.json"),
]);
assert.equal(source.version, pkg.version, "plugin and npm versions must match");
assert.equal(submission.test_cases.length, 5);
assert.equal(submission.negative_test_cases.length, 3);
const server = mcp.mcpServers.staticbot;
assert.equal(server.type, "streamable-http");
assert.equal(server.url, "https://mcp.staticbot.dev/mcp");
assert.equal(server.extensions["com.openai"].auth.client.tokenEndpointAuthMethod, "none");
assert(!Object.hasOwn(server, "command") && !Object.hasOwn(server, "headers"),
  "remote submission must not launch a local process or send fixed credentials");

const convertCase = ({ description, user_prompt, tools_triggered, expected_output,
  file_attachment_urls, expected_output_url }) => ({
  description,
  prompt: user_prompt,
  ...(tools_triggered ? { tools_triggered } : {}),
  expected_behavior: expected_output,
  ...(file_attachment_urls ? { file_attachment_urls } : {}),
  ...(expected_output_url ? { expected_output_url } : {}),
});
for (const test of submission.test_cases) {
  assert(Object.hasOwn(submission.tools, test.tools_triggered), "unknown review test tool");
}
const { skills, mcpServers, interface: listing, ...metadata } = source;
const manifest = {
  $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
  ...metadata,
  extensions: {
    "com.openai": {
      interface: { ...listing, category: "Developer Tools" },
      review: {
        test_cases: {
          positive: submission.test_cases.map(convertCase),
          negative: submission.negative_test_cases.map(convertCase),
        },
      },
    },
  },
};

// Only tracked skills and an explicit file allowlist enter the public ZIP.
const skillFiles = execFileSync("git", ["ls-files", "-z", "--", "skills/"], { cwd: root })
  .toString().split("\0").filter(Boolean);
assert(skillFiles.some((name) => name.endsWith("/SKILL.md")), "no tracked skills found");
const outputDir = path.join(root, "artifacts/chatgpt");
const archive = path.join(outputDir, `staticbot-${pkg.version}.zip`);
const staging = await mkdtemp(path.join(tmpdir(), "staticbot-submission-"));
try {
  await mkdir(outputDir, { recursive: true });
  for (const name of ["LICENSE", ...skillFiles]) {
    assert(!path.isAbsolute(name) && !name.split("/").includes(".."));
    const target = path.join(staging, name);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(path.join(root, name), target);
  }
  const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
  await writeFile(path.join(staging, "plugin.json"), json(manifest));
  await writeFile(path.join(staging, "mcp.json"), json(mcp));
  await rm(archive, { force: true });
  execFileSync("zip", ["-q", "-X", archive, "plugin.json", "mcp.json", "LICENSE", ...skillFiles],
    { cwd: staging });
  console.log(`Remote OAuth draft ZIP: ${archive}`);
  console.log(`Includes ${skillFiles.length} tracked skill files and 5 positive / 3 negative draft cases.`);
  console.log("Connection preparation only: reviewer fixtures, video, listing assets and live tool scan still need verification.");
} finally {
  await rm(staging, { recursive: true, force: true });
}
