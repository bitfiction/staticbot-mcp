import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import { createServer } from "../server/create-server.js";
import type { HostedConfig } from "./config.js";
import { createDelegatedContext } from "./context.js";
import { createServiceTokenProvider } from "./service-token.js";
import { createTokenVerifier, TokenVerificationError } from "./token-verifier.js";

const MCP_PATH = "/mcp";
const PROTECTED_RESOURCE_PATH = "/.well-known/oauth-protected-resource";

export function createHostedServer(config: HostedConfig) {
  const verifyToken = createTokenVerifier(config);
  const serviceToken = createServiceTokenProvider(config);

  /**
   * How an unauthenticated client discovers where to authenticate. Without the `resource_metadata`
   * hint the client has a 401 and nowhere to go, so the whole connect flow stalls before it starts.
   */
  function unauthorized(res: ServerResponse, description: string): void {
    res.writeHead(401, {
      "Content-Type": "application/json",
      "WWW-Authenticate":
        `Bearer resource_metadata="${new URL(PROTECTED_RESOURCE_PATH, config.mcpResource).href}", ` +
        `error="invalid_token", error_description="${description.replace(/"/g, "'")}"`,
    });
    res.end(JSON.stringify({ error: "invalid_token", error_description: description }));
  }

  async function handleMcp(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      unauthorized(res, "Missing bearer token");
      return;
    }

    let actor;
    try {
      actor = await verifyToken(header.slice("Bearer ".length));
    } catch (error) {
      if (error instanceof TokenVerificationError) {
        unauthorized(res, error.message);
        return;
      }
      throw error;
    }

    // Stateless: a server and transport per request, holding nothing between them. This is what lets
    // any replica answer any request without shared storage or sticky routing, and it is the shape
    // the 2026-07-28 protocol core assumes. Long-running work is represented by handles the client
    // passes back — migration and deployment IDs — never by state parked here.
    const server = createServer(createDelegatedContext(config, actor, serviceToken));
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

    res.on("close", () => {
      void transport.close();
      void server.close();
    });

    await server.connect(transport);
    await transport.handleRequest(req, res);
  }

  return createHttpServer((req, res) => {
    const path = (req.url ?? "").split("?")[0];

    if (req.method === "GET" && path === PROTECTED_RESOURCE_PATH) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        resource: config.mcpResource,
        authorization_servers: [config.issuer],
        scopes_supported: ["staticbot:read", "staticbot:write"],
        bearer_methods_supported: ["header"],
      }));
      return;
    }

    // Liveness must not depend on Keycloak or the Staticbot API: a probe that fails when a
    // dependency is down turns their outage into a restart loop that makes recovery slower.
    if (req.method === "GET" && (path === "/healthz" || path === "/readyz")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }

    if (path === MCP_PATH) {
      handleMcp(req, res).catch((error: Error) => {
        process.stderr.write(`MCP request failed: ${error.message}\n`);
        if (!res.headersSent) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "internal_error" }));
        }
      });
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "not_found" }));
  });
}
