import { afterEach, describe, expect, it } from "vitest";
import { detachAll } from "../cdp";
import {
  createFakeBrowserWindow,
  createFakeMcpServer,
  createFakeWebContents,
  getTool,
  parseInput,
} from "../testing";
import { registerHover } from "./hover";

afterEach(() => detachAll());

describe("hover", () => {
  it("requires non-empty surface + selector", () => {
    const server = createFakeMcpServer();
    registerHover(server.asMcpServer, () => ({}));
    const tool = getTool(server, "hover");
    expect(parseInput(tool, { surface: "main" }).success).toBe(false);
    expect(parseInput(tool, { selector: "#go" }).success).toBe(false);
    expect(parseInput(tool, { surface: "main", selector: "" }).success).toBe(
      false,
    );
    expect(parseInput(tool, { surface: "main", selector: "#go" }).success).toBe(
      true,
    );
  });

  it("dispatches mouseMoved at the resolved center", async () => {
    const server = createFakeMcpServer();
    const wc = createFakeWebContents({
      cdp: {
        "Runtime.evaluate": {
          result: {
            type: "object",
            value: { x: 10, y: 10, width: 80, height: 40 },
          },
        },
      },
    });
    const win = createFakeBrowserWindow({ visible: false, webContents: wc });
    registerHover(server.asMcpServer, () => ({
      hov_main: win.asBrowserWindow,
    }));
    const tool = getTool(server, "hover");
    const result = (await tool.handler({
      surface: "hov_main",
      selector: ".tip",
    })) as {
      structuredContent: { rect: { centerX: number; centerY: number } };
    };
    expect(win.showCalls).toBe(1); // hidden window auto-shown
    expect(result.structuredContent.rect.centerX).toBe(50);
    expect(result.structuredContent.rect.centerY).toBe(30);
    const moves = wc.cdpCalls.filter(
      (c) => c.method === "Input.dispatchMouseEvent",
    );
    expect(moves[0].params).toMatchObject({ type: "mouseMoved", x: 50, y: 30 });
  });

  it("times out when the selector never resolves to a sized element", async () => {
    const server = createFakeMcpServer();
    const wc = createFakeWebContents({
      cdp: {
        // Always returns null — never resolves a rect.
        "Runtime.evaluate": { result: { type: "object", value: null } },
      },
    });
    const win = createFakeBrowserWindow({ webContents: wc });
    registerHover(server.asMcpServer, () => ({
      hov_err: win.asBrowserWindow,
    }));
    const tool = getTool(server, "hover");
    await expect(
      tool.handler({
        surface: "hov_err",
        selector: ".missing",
        timeoutMs: 30,
      }),
    ).rejects.toThrow(/selector did not resolve/);
  });
});
