import type { McpServer, ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { z, type ZodRawShape } from "zod";

/**
 * Staticbot's public API is the source of truth for response DTOs. MCP tools preserve those JSON
 * responses under one stable top-level key so every descriptor can advertise structured output
 * without duplicating fifty evolving API schemas in this transport adapter.
 */
const apiResultSchema = z.union([
  z.record(z.unknown()),
  z.array(z.unknown()),
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
]);

export const apiToolOutputSchema = {
  result: apiResultSchema.describe("Parsed JSON response from the Staticbot public API"),
};

/** Register a JSON API-backed tool using the current SDK descriptor form and shared output shape. */
export function registerApiTool<InputShape extends ZodRawShape>(
  server: McpServer,
  name: string,
  description: string,
  inputSchema: InputShape,
  annotations: ToolAnnotations,
  handler: ToolCallback<InputShape>,
): void {
  server.registerTool(
    name,
    {
      description,
      inputSchema,
      outputSchema: apiToolOutputSchema,
      annotations,
    },
    handler,
  );
}

/** Keep legacy text content while also returning model- and client-readable structured JSON. */
export function apiToolResult(data: unknown, toText: (value: unknown) => string): CallToolResult {
  return {
    content: [{ type: "text", text: toText(data) }],
    structuredContent: { result: data },
  };
}
