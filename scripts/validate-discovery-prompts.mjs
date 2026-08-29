import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const promptPath = new URL("../evals/discovery-prompts.json", import.meta.url);
const cases = JSON.parse(await readFile(promptPath, "utf8"));
const validSkills = new Set([
  "deploy-web-app-with-staticbot",
  "migrate-vibe-coded-app",
  "sync-vibe-coded-app",
]);
const validKinds = new Set(["direct", "indirect", "negative"]);

assert(Array.isArray(cases), "discovery prompt fixture must be an array");
assert(cases.length >= 30 && cases.length <= 50, "keep 30-50 discovery prompts");

const ids = new Set();
const prompts = new Set();
const counts = new Map();

for (const testCase of cases) {
  assert.equal(typeof testCase.id, "string", "every case needs an id");
  assert(!ids.has(testCase.id), `duplicate case id: ${testCase.id}`);
  ids.add(testCase.id);

  assert.equal(typeof testCase.prompt, "string", `${testCase.id} needs a prompt`);
  assert(testCase.prompt.trim().length > 0, `${testCase.id} prompt is empty`);
  assert(!prompts.has(testCase.prompt), `duplicate prompt: ${testCase.prompt}`);
  prompts.add(testCase.prompt);

  assert(validKinds.has(testCase.kind), `${testCase.id} has invalid kind`);
  assert(testCase.expectedSkill === null || validSkills.has(testCase.expectedSkill),
    `${testCase.id} has invalid expectedSkill`);
  assert(testCase.kind !== "negative" || testCase.expectedSkill === null,
    `${testCase.id} negative case must not select a skill`);
  counts.set(testCase.expectedSkill, (counts.get(testCase.expectedSkill) ?? 0) + 1);
}

for (const skill of validSkills) {
  assert((counts.get(skill) ?? 0) >= 8, `${skill} needs at least 8 positive cases`);
}
assert((counts.get(null) ?? 0) >= 10, "need at least 10 negative cases");

console.log(`Discovery prompt validation passed: ${cases.length} cases`);
