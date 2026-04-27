// Tracer-bullet smoke test for `@nebula-agents/electron-mcp`.
//
// This test launches a real Electron app via Playwright's `_electron`,
// boots an MCP server inside it via `createElectronMcpServer`, then drives
// three tools end-to-end through the public HTTP transport:
//
//   1. `list_surfaces`  — returns the configured surface keys
//   2. `evaluate`       — runs JS in the renderer main world
//   3. `screenshot`     — returns a PNG of the surface
//
// Anything that talks to the SDK / debugger / loopback HTTP path inside
// the package runs for real. The only fixture is the consumer-side
// Electron main script that wires our public API to a hidden window.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { expect, test } from "@playwright/test";
import { _electron as electron, type ElectronApplication } from "playwright";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Pass the *directory* (not the file) so Electron resolves the
// fixture's `package.json#main` and enters main-process mode. Pointing
// it at the .cjs file directly leaves `app`/`BrowserWindow` undefined.
const FIXTURE_DIR = path.join(__dirname, "fixtures");

// Helper: read fixture stdout until the `MCP_URL=…` line our fixture
// prints when the server is listening. Times out via Playwright's
// per-test timeout if the line never arrives.
function waitForMcpUrl(app: ElectronApplication): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = app.process();
    let buf = "";
    const onData = (chunk: Buffer | string) => {
      buf += chunk.toString();
      const match = buf.match(/MCP_URL=(\S+)/);
      if (match?.[1]) {
        proc.stdout?.off("data", onData);
        resolve(match[1]);
      }
    };
    proc.stdout?.on("data", onData);
    proc.once("exit", (code) => {
      if (!buf.includes("MCP_URL=")) {
        reject(
          new Error(
            `fixture exited (code ${code}) before printing MCP_URL.\n` +
              `stdout so far:\n${buf}`,
          ),
        );
      }
    });
  });
}

test("MCP server drives a real Electron surface end-to-end", async () => {
  // `ELECTRON_RUN_AS_NODE=1` forces Electron to behave like plain Node
  // (no `app`/`BrowserWindow`); some shells set it for tooling reasons.
  // Strip it from the spawned env so this test isn't shell-dependent.
  const { ELECTRON_RUN_AS_NODE: _, ...cleanEnv } = process.env;
  const app = await electron.launch({
    args: [FIXTURE_DIR],
    env: { ...cleanEnv, ELECTRON_DISABLE_SANDBOX: "1" },
  });

  try {
    const url = await waitForMcpUrl(app);
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);

    const client = new Client(
      { name: "electron-mcp-smoke", version: "0.0.0" },
      { capabilities: {} },
    );
    const transport = new StreamableHTTPClientTransport(new URL(url));
    await client.connect(transport);

    try {
      // --- list_surfaces ----------------------------------------------
      const list = await client.callTool({
        name: "list_surfaces",
        arguments: {},
      });
      expect(list.isError).toBeFalsy();
      const listed = (list.structuredContent ?? {}) as {
        surfaces?: Array<{ surface: string; present: boolean }>;
      };
      const present = (listed.surfaces ?? [])
        .filter((s) => s.present)
        .map((s) => s.surface);
      expect(present).toEqual(["main"]);

      // --- evaluate ---------------------------------------------------
      const evaluated = await client.callTool({
        name: "evaluate",
        arguments: { surface: "main", expression: "1 + 1" },
      });
      expect(evaluated.isError).toBeFalsy();
      const evalText = (evaluated.content as Array<{ type: string; text?: string }>)
        .find((c) => c.type === "text")?.text;
      expect(evalText).toBe("2");

      // --- screenshot -------------------------------------------------
      const shot = await client.callTool({
        name: "screenshot",
        arguments: { surface: "main" },
      });
      expect(shot.isError).toBeFalsy();
      const image = (shot.content as Array<{ type: string; data?: string; mimeType?: string }>)
        .find((c) => c.type === "image");
      expect(image?.mimeType).toBe("image/png");
      expect(image?.data).toBeTruthy();
      // Base64 of a non-empty PNG decodes to at least the 8-byte signature
      // plus an IHDR chunk — well over 30 bytes once base64-encoded.
      expect((image?.data ?? "").length).toBeGreaterThan(40);
    } finally {
      await client.close();
    }
  } finally {
    await app.close();
  }
});
