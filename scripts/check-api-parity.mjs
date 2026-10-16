import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from '../dist/server/create-server.js';
import { collectToolCalls, compareCoverage, openApiRoutes, parseBaseline } from './lib/api-parity.mjs';

const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--openapi')) {
  throw new Error('Usage: node scripts/check-api-parity.mjs [--openapi <file-or-URL>]');
}
const input = args[1] ? (/^https?:/.test(args[1]) ? args[1] : pathToFileURL(resolve(args[1])))
  : new URL('../contracts/app-v1-openapi.json', import.meta.url);
let document;
if (typeof input === 'string') {
  const response = await fetch(input, { signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`OpenAPI fetch failed: HTTP ${response.status}`);
  document = await response.json();
} else document = JSON.parse(await readFile(input, 'utf8'));
const routes = openApiRoutes(document);
const baseline = parseBaseline(await readFile(new URL('../contracts/api-mcp-parity-baseline.txt', import.meta.url), 'utf8'));
const { calls, toolCount } = await collectToolCalls(createServer);
const result = compareCoverage(routes, calls, baseline);
const sections = [
  ['V1 routes with no MCP coverage; add a tool or document a deliberate deferral:', result.missing],
  ['Tools call routes/methods absent from the app contract:', result.unknown],
  ['Baseline entries are now covered or removed; delete these stale deferrals:', result.stale],
].filter(([, entries]) => entries.length);
if (sections.length) {
  for (const [title, entries] of sections) console.error(`${title}\n${entries.map(entry => `  ${entry}`).join('\n')}\n`);
  process.exitCode = 1;
} else console.log(`API → MCP parity passed: ${routes.length} V1 operations, ${toolCount} runtime tools, `
  + `${result.covered.size} covered routes, ${result.gaps.size} tracked differences. Contract: ${input}`);
