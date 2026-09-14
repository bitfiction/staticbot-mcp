import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import { logEvent } from "../log.js";
import { createServer } from "../server/create-server.js";
import type { HostedConfig } from "./config.js";
import { createDelegatedContext, recordClientConnection, type McpClientInfo } from "./context.js";
import { createServiceTokenProvider } from "./service-token.js";
import { createTokenVerifier, TokenVerificationError, type Actor } from "./token-verifier.js";

const MCP_PATH = "/mcp";
const PROTECTED_RESOURCE_PATH = "/.well-known/oauth-protected-resource";

/**
 * Paths whose requests are never logged.
 *
 * The probes run every 5s (readiness) and 20s (liveness) per replica — roughly 43,000 requests a
 * day — and a line each would both bury the traffic anyone is actually looking for and spend the
 * whole retention budget on the word "ok".
 */
const UNLOGGED_PATHS = new Set(["/healthz", "/readyz"]);

/**
 * Per-request scratch space, populated as the request is authenticated and read once the response
 * finishes. A plain object rather than a closure variable because the response listener is
 * registered before the actor is known.
 */
interface RequestLogContext {
  actor?: Actor;
  client?: McpClientInfo;
}

export function createHostedServer(config: HostedConfig) {
  const verifyToken = createTokenVerifier(config);
  const serviceToken = createServiceTokenProvider(config);

  /**
   * How an unauthenticated client discovers where to authenticate. Without the `resource_metadata`
   * hint the client has a 401 and nowhere to go, so the whole connect flow stalls before it starts.
   */
  function unauthorized(req: IncomingMessage, res: ServerResponse, description: string): void {
    // A rejected token is the one failure a customer cannot diagnose from their own side — their
    // client simply never lists the tools, with no error to report. Without this line the only
    // trace of a misconfigured connection anywhere is in their client's console.
    logEvent(
      "mcp.unauthorized",
      {
        method: req.method,
        path: (req.url ?? "").split("?")[0],
        reason: description,
      },
      "warn",
    );

    res.writeHead(401, {
      "Content-Type": "application/json",
      "WWW-Authenticate":
        `Bearer resource_metadata="${new URL(PROTECTED_RESOURCE_PATH, config.mcpResource).href}", ` +
        `error="invalid_token", error_description="${description.replace(/"/g, "'")}"`,
    });
    res.end(JSON.stringify({ error: "invalid_token", error_description: description }));
  }

  async function handleMcp(
    req: IncomingMessage,
    res: ServerResponse,
    log: RequestLogContext,
  ): Promise<void> {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      unauthorized(req, res, "Missing bearer token");
      return;
    }

    let actor;
    try {
      actor = await verifyToken(header.slice("Bearer ".length));
    } catch (error) {
      if (error instanceof TokenVerificationError) {
        unauthorized(req, res, error.message);
        return;
      }
      throw error;
    }

    // Publishing the actor here is what makes the request line name a person. It is recorded after
    // verification and before any tool runs, so a request that dies mid-flight still says who it
    // was for.
    log.actor = actor;

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

    // Only an initialize request populates this value. Recording here gives us one durable row per
    // successful MCP handshake while keeping the transport itself stateless between HTTP requests.
    const clientInfo = server.server.getClientVersion();
    if (clientInfo) {
      log.client = clientInfo;
      try {
        await recordClientConnection(config, actor, serviceToken, clientInfo);
      } catch (error) {
        // Provenance is operational data, not authorization. A temporary database/API failure must
        // not turn a successful MCP connection into an outage; a later initialize will retry it.
        logEvent(
          "mcp.client_connection_failed",
          {
            actor: actor.email,
            oauthClientId: actor.oauthClientId,
            client: `${clientInfo.name}/${clientInfo.version}`,
            error: (error as Error).message,
          },
          "warn",
        );
      }
    }
  }

  return createHttpServer((req, res) => {
    const path = (req.url ?? "").split("?")[0];

    // Answered before any logging is wired up. Liveness must not depend on Keycloak or the
    // Staticbot API: a probe that fails when a dependency is down turns their outage into a restart
    // loop that makes recovery slower.
    if (req.method === "GET" && UNLOGGED_PATHS.has(path)) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }

    const startedAt = Date.now();
    const log: RequestLogContext = {};
    let logged = false;

    // Emitted on the response's own lifecycle rather than wrapped around the handler, so every exit
    // path is accounted for — including the 401 written before a handler is ever entered, and the
    // 404. `close` is the backstop: a client that hangs up mid-request never fires `finish`, and an
    // agent abandoning a call is worth seeing rather than silently losing.
    const logRequest = (finished: boolean): void => {
      if (logged) {
        return;
      }
      logged = true;
      logEvent(
        "mcp.request",
        {
          method: req.method,
          path,
          status: res.statusCode,
          durationMs: Date.now() - startedAt,
          ...(finished ? {} : { clientDisconnected: true }),
          ...(log.actor ? { actor: log.actor.email, oauthClientId: log.actor.oauthClientId } : {}),
          ...(log.client ? { client: `${log.client.name}/${log.client.version}` } : {}),
        },
        res.statusCode >= 400 ? "warn" : "info",
      );
    };
    res.on("finish", () => logRequest(true));
    res.on("close", () => logRequest(false));

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

    if (path === MCP_PATH) {
      handleMcp(req, res, log).catch((error: Error) => {
        // Reached only by failures that escape the tool layer entirely. A tool that throws is
        // caught by the SDK and returned to the client as an error result; that path is logged by
        // apiFetch, which is where the useful detail is.
        logEvent(
          "mcp.request_failed",
          { method: req.method, path, error: error.message },
          "error",
        );
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
