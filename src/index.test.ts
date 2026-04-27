// Lifecycle tests for the explicit start()/stop() API. These exercise
// the real HTTP transport on an ephemeral loopback port — they don't
// reach into Electron and don't need a fake McpServer.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElectronMcpServer, recommendedGuards } from "./index";

// Ephemeral-port helper — the harness picks a free port via `port: 0`
// and the handle exposes the resolved URL.
async function startServer(
  options: Parameters<typeof createElectronMcpServer>[0] = {
    getSurfaces: () => ({}),
  },
) {
  const handle = createElectronMcpServer({ port: 0, ...options });
  return handle;
}

const handlesToStop: Array<{ stop: () => Promise<void> }> = [];

beforeEach(() => {
  // Silence the `[mcp] listening on ...` startup log — fine in dev,
  // distracting in test output. The shared `createLogger` routes
  // info/warn through console.info/warn.
  vi.spyOn(console, "info").mockImplementation(() => {});
});

afterEach(async () => {
  while (handlesToStop.length > 0) {
    const h = handlesToStop.pop();
    if (h) await h.stop().catch(() => {});
  }
  vi.restoreAllMocks();
});

// Minimal ToolDef used in registration-ordering and integration tests.
function pingTool(): {
  name: string;
  config: { title: string; description: string };
  handler: () => Promise<{ content: Array<{ type: "text"; text: string }> }>;
} {
  return {
    name: "ping",
    config: { title: "Ping", description: "Returns pong." },
    handler: async () => ({ content: [{ type: "text", text: "pong" }] }),
  };
}

describe("createElectronMcpServer", () => {
  it("isRunning is false before start, true after start, false after stop", async () => {
    const handle = await startServer();
    handlesToStop.push(handle);
    expect(handle.isRunning).toBe(false);
    expect(handle.url).toBeNull();
    await handle.start();
    expect(handle.isRunning).toBe(true);
    expect(handle.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
    await handle.stop();
    expect(handle.isRunning).toBe(false);
  });

  it("addTool throws when called after start()", async () => {
    const handle = await startServer();
    handlesToStop.push(handle);
    await handle.start();
    expect(() => handle.addTool(pingTool())).toThrow(/addTool.*after start/i);
  });

  it("tools added before start() are reachable via the MCP client", async () => {
    const handle = await startServer();
    handlesToStop.push(handle);
    handle.addTool(pingTool());
    await handle.start();
    if (!handle.url) throw new Error("expected handle.url after start()");

    const transport = new StreamableHTTPClientTransport(new URL(handle.url));
    const client = new Client({ name: "lifecycle-test", version: "0.0.0" });
    try {
      await client.connect(transport);
      const tools = await client.listTools();
      expect(tools.tools.map((t) => t.name)).toContain("ping");

      const result = await client.callTool({ name: "ping", arguments: {} });
      const content = result.content as Array<{ type: string; text: string }>;
      expect(content[0]).toEqual({ type: "text", text: "pong" });
    } finally {
      await client.close().catch(() => {});
      await transport.close().catch(() => {});
    }
  });

  it("double start() and double stop() are safe", async () => {
    const handle = await startServer();
    handlesToStop.push(handle);
    await Promise.all([handle.start(), handle.start()]);
    expect(handle.isRunning).toBe(true);
    const url = handle.url;
    await handle.start();
    expect(handle.url).toBe(url);

    await Promise.all([handle.stop(), handle.stop()]);
    expect(handle.isRunning).toBe(false);
    await handle.stop();
    expect(handle.isRunning).toBe(false);
  });

  it("interleaved start/stop calls run in order, not in parallel", async () => {
    // Cross-direction race regression: with the previous split
    // `starting` / `stopping` latches a `stop()` issued while
    // `start()` was in flight returned early (running was still
    // null) and the server stayed up after start resolved. The
    // mutex now serialises both directions.
    const handle = await startServer();
    handlesToStop.push(handle);
    const startP = handle.start();
    const stopP = handle.stop();
    await Promise.all([startP, stopP]);
    expect(handle.isRunning).toBe(false);
  });
});

describe("recommendedGuards", () => {
  it("throws a packaged-state error when called without options", () => {
    expect(() => recommendedGuards()).toThrow(/isPackaged/i);
  });

  it("allows startup when the app is unpackaged and the opt-in env var is enabled", () => {
    expect(
      recommendedGuards({
        isPackaged: false,
        env: { MY_APP_MCP: "1" },
        envVar: "MY_APP_MCP",
      }),
    ).toBe(true);
  });

  it("blocks startup when the opt-in env var is not enabled", () => {
    expect(
      recommendedGuards({
        isPackaged: false,
        env: {},
        envVar: "MY_APP_MCP",
      }),
    ).toBe(false);
  });

  it("blocks startup in packaged builds even when the opt-in env var is enabled", () => {
    expect(
      recommendedGuards({
        isPackaged: true,
        env: { MY_APP_MCP: "1" },
        envVar: "MY_APP_MCP",
      }),
    ).toBe(false);
  });

  it("accepts an Electron app-like object for the packaged-state check", () => {
    expect(
      recommendedGuards({
        app: { isPackaged: false },
        env: { MY_APP_MCP: "1" },
        envVar: "MY_APP_MCP",
      }),
    ).toBe(true);
  });

  it("blocks startup when an Electron app-like object reports a packaged build", () => {
    expect(
      recommendedGuards({
        app: { isPackaged: true },
        env: { MY_APP_MCP: "1" },
        envVar: "MY_APP_MCP",
      }),
    ).toBe(false);
  });

  it("throws when no packaged-state source is provided", () => {
    expect(() =>
      recommendedGuards({
        env: { MY_APP_MCP: "1" },
        envVar: "MY_APP_MCP",
      }),
    ).toThrow(/isPackaged/i);
  });
});
