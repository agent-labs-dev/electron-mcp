// Streamable HTTP transport on `127.0.0.1` (not `localhost` — that
// can resolve to IPv6). Bare `node:http` (no Express/Hono for one
// route). No Origin check — the only path here is a localhost MCP
// client and Claude Code doesn't send Origin anyway.

import { randomUUID } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { detachAll } from "./cdp.js";
import type { SurfaceGetter } from "./surfaces.js";
import type { ToolDef } from "./tool-def.js";
import { registerAllTools } from "./tools/index.js";

// Minimal stdout/stderr logger — extracted from nebula-desktop's
// `@util/log` so this package has no internal-tooling dep. Consumers
// that want structured logs can wrap stdout themselves.
const log = {
  info: (msg: string) => {
    console.log(`[mcp] ${msg}`);
  },
  warn: (msg: string) => {
    console.warn(`[mcp] ${msg}`);
  },
  error: (msg: string) => {
    console.error(`[mcp] ${msg}`);
  },
};

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 9229;
const MCP_PATH = "/mcp";
/** Retry once on EADDRINUSE — the previous Electron may still be releasing. */
const EADDRINUSE_RETRY_DELAY_MS = 100;

// Default `initialize` instructions sent to MCP clients. Generic, so the
// embedded server is useful out of the box. Consumers can override via
// `config.instructions` when they want app-specific guidance (which
// surface names exist, when to reach for the tools, etc.).
const DEFAULT_SERVER_INSTRUCTIONS = `\
This server drives the floating BrowserWindow surfaces of a running
Electron app. Reach for it to inspect or validate renderer-visible
state — not for planning, not for main-process changes.

Typical flow:
  1. list_surfaces — discover which surfaces are live.
  2. show_surface { surface: "<name>" } — bring the target into view.
  3. screenshot { surface: "<name>" } to see the rendered result, or
     evaluate { surface: "<name>", expression: "…" } to inspect state.

Scope of \`evaluate\`: runs in the renderer MAIN WORLD.
Reachable: document, window, React tree, your stores, fetch.
NOT reachable: require("electron"), process, Node APIs.

If a tool errors with "surface not available", the consumer Electron
app isn't running or hasn't registered that surface yet.`;

interface McpServerConfig {
  getSurfaces: SurfaceGetter;
  // Consumer-registered tools (e.g. an app's `trigger_hotkey`). Bound
  // to every per-session McpServer alongside the bundled tools.
  extraTools?: readonly ToolDef[];
  // Pass `0` for an ephemeral port (used by tests).
  port?: number;
  // Only override to `::1` if you really want IPv6 loopback.
  host?: string;
  // Override server identity advertised in `initialize`. Defaults to
  // `{ name: "@nebula-agents/electron-mcp", version: <pkg-version> }`.
  serverInfo?: { name: string; version: string };
  // Override the `initialize.instructions` text. Defaults to
  // `DEFAULT_SERVER_INSTRUCTIONS` above.
  instructions?: string;
}

export interface RunningMcpServer {
  stop: () => Promise<void>;
  url: string;
}

export async function startMcpServer(
  config: McpServerConfig,
): Promise<RunningMcpServer> {
  const host = config.host ?? DEFAULT_HOST;
  const port = config.port ?? DEFAULT_PORT;

  // Hard loopback gate — anything else exposes evaluate/screenshot/
  // CDP over the network.
  if (host !== "127.0.0.1" && host !== "::1" && host !== "localhost") {
    throw new Error(
      `[mcp] refusing to bind non-loopback host "${host}" — only 127.0.0.1 / ::1 / localhost are allowed`,
    );
  }

  // Per-session registry — `StreamableHTTPServerTransport` accepts
  // only one session per lifetime, so we mint a fresh transport +
  // McpServer pair per `initialize` (matches the SDK's multi-session
  // example).
  const sessions = new Map<string, Session>();
  // Latch flipped at the start of `stop()` so concurrent initializes
  // can't sneak a fresh session past the snapshot and then keep
  // `httpServer.close()` waiting on its open stream.
  let shuttingDown = false;

  async function createSession(): Promise<Session> {
    const sessionServer = new McpServer(
      config.serverInfo ?? {
        name: "@nebula-agents/electron-mcp",
        version: "0.1.0",
      },
      {
        capabilities: { tools: {} },
        // Returned in `initialize`; shown every session.
        instructions: config.instructions ?? DEFAULT_SERVER_INSTRUCTIONS,
      },
    );
    registerAllTools(sessionServer, { getSurfaces: config.getSurfaces });
    // The SDK's `registerTool` is generic over Zod schemas; our
    // `ToolDef` widens those to `unknown` so consumers don't have to
    // chase the SDK's compat-types. The runtime still validates the
    // shape at registration time. Cast through `unknown` here, not by
    // rebinding the method (would drop the `this` pointer to the
    // McpServer's tool registry).
    type LooseRegister = (
      name: string,
      config: ToolDef["config"],
      handler: ToolDef["handler"],
    ) => unknown;
    for (const tool of config.extraTools ?? []) {
      (sessionServer.registerTool as unknown as LooseRegister).call(
        sessionServer,
        tool.name,
        tool.config,
        tool.handler,
      );
    }

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sid) => {
        sessions.set(sid, { transport, server: sessionServer });
      },
    });
    let serverClosed = false;
    transport.onclose = () => {
      if (transport.sessionId) {
        sessions.delete(transport.sessionId);
      }
      // Always close the paired server — pre-init disconnects would
      // otherwise leak an orphan `McpServer` per failed connection.
      // Re-entry guard: `McpServer.close()` calls `transport.close()`
      // which fires this handler again. Without the latch the SDK
      // recurses until the call stack overflows.
      if (serverClosed) return;
      serverClosed = true;
      sessionServer.close().catch(() => {});
    };
    await sessionServer.connect(transport);
    return { transport, server: sessionServer };
  }

  const httpServer = createServer(async (req, res) => {
    try {
      await routeRequest(req, res, sessions, createSession, () => shuttingDown);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error(`request failed: ${msg}`);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ error: msg }));
      } else {
        res.destroy();
      }
    }
  });

  try {
    await listenWithRetry(httpServer, port, host);
  } catch (err) {
    httpServer.close();
    throw err;
  }

  // `port: 0` resolves to a kernel-assigned ephemeral port (used by
  // tests). Read it back from the bound socket so the URL is correct.
  const address = httpServer.address();
  const boundPort =
    typeof address === "object" && address ? address.port : port;
  // IPv6 literals must be bracketed in a URL authority — `http://::1:9229/mcp`
  // is not parseable, `http://[::1]:9229/mcp` is.
  const urlHost = host.includes(":") ? `[${host}]` : host;
  const url = `http://${urlHost}:${boundPort}${MCP_PATH}`;
  log.info(`listening on ${url}`);

  return {
    url,
    stop: async () => {
      // Flip the gate first so `routeRequest`/`createSession` reject
      // any in-flight `initialize` before we snapshot — otherwise a
      // session minted after the snapshot keeps `httpServer.close()`
      // hanging on its open stream.
      shuttingDown = true;
      detachAll();
      // Snapshot — `server.close()` fires `transport.onclose` which
      // mutates `sessions`.
      const snapshot = [...sessions.values()];
      sessions.clear();
      for (const { server: sessionServer } of snapshot) {
        await sessionServer.close().catch(() => {
          // Best-effort — transport may already be torn down.
        });
      }
      await new Promise<void>((resolve) => {
        httpServer.close(() => resolve());
      });
    },
  };
}

// JSON-RPC messages are tiny; cap the body to keep a rogue stream
// from OOMing main.
const MAX_BODY_BYTES = 4 * 1024 * 1024;

interface Session {
  transport: StreamableHTTPServerTransport;
  server: McpServer;
}

async function routeRequest(
  req: IncomingMessage,
  res: ServerResponse,
  sessions: Map<string, Session>,
  createSession: () => Promise<Session>,
  isShuttingDown: () => boolean,
): Promise<void> {
  const url = new URL(
    req.url ?? "/",
    `http://${req.headers.host ?? "localhost"}`,
  );

  if (url.pathname !== MCP_PATH) {
    res.statusCode = 404;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ error: `not found: ${url.pathname}` }));
    return;
  }

  // Reject everything once `stop()` has flipped the latch — sessions
  // minted after the snapshot would leak open streams and stall
  // `httpServer.close()`.
  if (isShuttingDown()) {
    res.statusCode = 503;
    res.setHeader("content-type", "application/json");
    res.setHeader("connection", "close");
    res.end(
      JSON.stringify({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Server is shutting down" },
        id: null,
      }),
    );
    return;
  }

  const headerSessionId = req.headers["mcp-session-id"];
  const sessionId =
    typeof headerSessionId === "string" ? headerSessionId : undefined;

  if (req.method === "POST") {
    const parsed = await readJsonBody(req);

    // Discriminate on `ok` not body shape — a bare-string body like
    // `"ping"` is valid JSON and must fall through to the normal
    // not-an-initialize branch below.
    if (!parsed.ok) {
      if (parsed.reason === "too-large") {
        res.statusCode = 413;
        res.setHeader("content-type", "application/json");
        // Pair with the `socket.destroy()` callback below to terminate
        // the upload only after the 413 response actually flushes —
        // destroying synchronously after `res.end()` can race the
        // flush and surface as ECONNRESET on the client.
        res.setHeader("connection", "close");
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            error: {
              code: -32600,
              message: `Request body exceeds ${MAX_BODY_BYTES} bytes`,
            },
            id: null,
          }),
          () => req.socket?.destroy(),
        );
        return;
      }
      res.statusCode = 400;
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          error: { code: -32700, message: "Parse error" },
          id: null,
        }),
      );
      return;
    }
    const body = parsed.body;

    if (sessionId) {
      const existing = sessions.get(sessionId);
      if (!existing) {
        // Tell the client to re-initialize instead of retrying.
        res.statusCode = 404;
        res.setHeader("content-type", "application/json");
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            error: { code: -32001, message: "Unknown session" },
            id: null,
          }),
        );
        return;
      }
      await existing.transport.handleRequest(req, res, body);
      return;
    }

    // First POST must be `initialize` — anything else would mint a
    // zombie session.
    if (isInitializeRequest(body)) {
      const { transport } = await createSession();
      await transport.handleRequest(req, res, body);
      return;
    }

    res.statusCode = 400;
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message:
            "Bad Request: POST without Mcp-Session-Id must be initialize",
        },
        id: null,
      }),
    );
    return;
  }

  // GET opens the SSE stream the server uses to push notifications;
  // DELETE terminates the session. Both require an existing session ID.
  if (req.method === "GET" || req.method === "DELETE") {
    const existing = sessionId ? sessions.get(sessionId) : undefined;
    if (!existing) {
      res.statusCode = 400;
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          error: { code: -32000, message: "Missing or invalid Mcp-Session-Id" },
          id: null,
        }),
      );
      return;
    }
    await existing.transport.handleRequest(req, res);
    return;
  }

  res.statusCode = 405;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ error: `method not allowed: ${req.method}` }));
}

// Branch on `ok`, not body shape — `"ping"` and `42` are valid
// non-object bodies. Two failure reasons so the caller can pick
// `400 -32700` (parse) vs `413` (too-large).
type ReadJsonBodyResult =
  | { ok: true; body: unknown }
  | { ok: false; reason: "parse"; raw: string }
  | { ok: false; reason: "too-large" };

async function readJsonBody(req: IncomingMessage): Promise<ReadJsonBodyResult> {
  let total = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    total += buf.length;
    if (total > MAX_BODY_BYTES) {
      // Don't `req.destroy()` — that closes the socket before the
      // 413 can flush. TCP backpressure stops the upload safely.
      return { ok: false, reason: "too-large" };
    }
    chunks.push(buf);
  }
  if (chunks.length === 0) return { ok: true, body: null };
  const text = Buffer.concat(chunks).toString("utf-8");
  if (!text) return { ok: true, body: null };
  try {
    return { ok: true, body: JSON.parse(text) };
  } catch {
    return { ok: false, reason: "parse", raw: text };
  }
}

// One 100ms retry papers over the brief port race when dev.mjs
// kills + respawns Electron on main-bundle changes.
function listenWithRetry(
  httpServer: Server,
  port: number,
  host: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let retried = false;

    const onError = (err: NodeJS.ErrnoException): void => {
      if (err.code === "EADDRINUSE" && !retried) {
        retried = true;
        log.warn(
          `port ${port} busy, retrying in ${EADDRINUSE_RETRY_DELAY_MS}ms…`,
        );
        setTimeout(() => {
          httpServer.listen(port, host);
        }, EADDRINUSE_RETRY_DELAY_MS);
        return;
      }
      httpServer.off("listening", onListening);
      reject(err);
    };

    const onListening = (): void => {
      httpServer.off("error", onError);
      resolve();
    };

    httpServer.on("error", onError);
    httpServer.once("listening", onListening);
    httpServer.listen(port, host);
  });
}
