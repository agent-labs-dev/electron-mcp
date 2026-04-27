import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { _electron as electron, expect, test } from "@playwright/test";

test("drives a real Electron BrowserWindow through MCP", async () => {
  test.skip(
    process.platform === "darwin",
    "Playwright _electron currently passes --remote-debugging-port=0, which Electron 41 rejects on macOS.",
  );

  const app = await electron.launch({
    args: ["test/electron/fixture/main.mjs"],
  });

  try {
    const url = await app.evaluate(async () => {
      for (let i = 0; i < 100; i += 1) {
        const value = globalThis.__electronMcpSmokeUrl;
        if (typeof value === "string") return value;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error("MCP server did not start");
    });

    const transport = new StreamableHTTPClientTransport(new URL(url));
    const client = new Client({ name: "electron-smoke", version: "0.0.0" });
    try {
      await client.connect(transport);

      const surfaces = await client.callTool({
        name: "list_surfaces",
        arguments: {},
      });
      expect(JSON.stringify(surfaces.content)).toContain("main");

      const evaluated = await client.callTool({
        name: "evaluate",
        arguments: {
          surface: "main",
          expression: "document.querySelector('#title')?.textContent",
        },
      });
      expect(JSON.stringify(evaluated.content)).toContain("Electron MCP Smoke");

      const screenshot = await client.callTool({
        name: "screenshot",
        arguments: { surface: "main" },
      });
      expect(JSON.stringify(screenshot.content)).toContain("image");
    } finally {
      await client.close().catch(() => {});
      await transport.close().catch(() => {});
    }
  } finally {
    await app.close();
  }
});
