#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const API_URL = process.env.STATICBOT_API_URL ?? "http://localhost:9000";
const API_KEY = process.env.STATICBOT_API_KEY;

if (!API_KEY) {
  process.stderr.write("Error: STATICBOT_API_KEY environment variable is required\n");
  process.exit(1);
}

async function apiFetch(path: string, options: RequestInit = {}): Promise<unknown> {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Authorization": `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });

  const text = await res.text();

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}: ${text}`);
  }

  return text ? JSON.parse(text) : null;
}

function toText(data: unknown): string {
  return JSON.stringify(data, null, 2);
}

const server = new McpServer({
  name: "staticbot",
  version: "1.0.0",
});

// ─── Migrations ───────────────────────────────────────────────────────────────

server.tool(
  "list_migrations",
  "List all migrations for the organization. Optionally filter by status.",
  {
    status: z.string().optional().describe(
      "Filter by status. One of: PENDING, IN_PROGRESS, PAUSED_FOR_APPROVAL, PAUSED_FOR_USER_ACTION, PAUSED_BY_USER, COMPLETED, COMPLETED_WITH_ERRORS, FAILED"
    ),
  },
  async ({ status }) => {
    const qs = status ? `?status=${encodeURIComponent(status)}` : "";
    const data = await apiFetch(`/api/v1/migrations${qs}`);
    return { content: [{ type: "text", text: toText(data) }] };
  }
);

server.tool(
  "get_migration",
  "Get the current status and phase breakdown of a migration.",
  {
    id: z.string().uuid().describe("Migration ID"),
  },
  async ({ id }) => {
    const data = await apiFetch(`/api/v1/migrations/${id}`);
    return { content: [{ type: "text", text: toText(data) }] };
  }
);

server.tool(
  "confirm_migration",
  "Approve a migration that is PAUSED_FOR_APPROVAL (after discovery completes) to continue execution.",
  {
    id: z.string().uuid().describe("Migration ID"),
  },
  async ({ id }) => {
    const data = await apiFetch(`/api/v1/migrations/${id}/confirm`, { method: "POST" });
    return { content: [{ type: "text", text: toText(data) }] };
  }
);

server.tool(
  "resume_migration",
  "Resume a migration that is PAUSED_BY_USER or PAUSED_FOR_USER_ACTION.",
  {
    id: z.string().uuid().describe("Migration ID"),
  },
  async ({ id }) => {
    const data = await apiFetch(`/api/v1/migrations/${id}/resume`, { method: "POST" });
    return { content: [{ type: "text", text: toText(data) }] };
  }
);

server.tool(
  "get_migration_deployments",
  "List all deployments associated with a migration's stack.",
  {
    id: z.string().uuid().describe("Migration ID"),
  },
  async ({ id }) => {
    const data = await apiFetch(`/api/v1/migrations/${id}/deployments`);
    return { content: [{ type: "text", text: toText(data) }] };
  }
);

// ─── Deployments ──────────────────────────────────────────────────────────────

server.tool(
  "get_deployment",
  "Get the status of a deployment. When status is WAITING, includes required DNS records to configure.",
  {
    id: z.string().uuid().describe("Deployment ID"),
  },
  async ({ id }) => {
    const data = await apiFetch(`/api/v1/deployments/${id}`);
    return { content: [{ type: "text", text: toText(data) }] };
  }
);

// ─── Stacks ───────────────────────────────────────────────────────────────────

server.tool(
  "create_stack",
  "Create a new infrastructure stack from a template. Returns the stack ID and a status URL.",
  {
    name: z.string().describe("Human-readable name for the stack"),
    templateId: z.string().uuid().describe("ID of the template to use"),
    configOverrides: z.record(z.string()).optional().describe(
      "Optional key/value overrides for template configuration variables"
    ),
    domainOption: z.discriminatedUnion("type", [
      z.object({
        type: z.literal("AUTO_GENERATED"),
      }).describe("Let Staticbot generate a domain automatically"),
      z.object({
        type: z.literal("CUSTOM_DOMAIN"),
        domainName: z.string().describe("Custom domain name, e.g. example.com"),
      }).describe("Use a custom domain name"),
      z.object({
        type: z.literal("EXISTING_DOMAIN"),
        dnsDomainId: z.string().uuid().describe("ID of an existing DNS domain registered in Staticbot"),
      }).describe("Use a DNS domain already registered in Staticbot"),
    ]).describe("How to assign a domain to this stack"),
  },
  async ({ name, templateId, configOverrides, domainOption }) => {
    const body = { name, templateId, configOverrides: configOverrides ?? {}, domainOption };
    const data = await apiFetch("/api/v1/stacks", {
      method: "POST",
      body: JSON.stringify(body),
    });
    return { content: [{ type: "text", text: toText(data) }] };
  }
);

// ─── Start ────────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
