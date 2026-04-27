import { describe, expect, it } from "vitest";
import {
  createFakeBrowserWindow,
  createFakeMcpServer,
  createFakeWebContents,
  getTool,
  parseInput,
} from "../testing";
import { registerWaitForLoad } from "./wait-for-load";

describe("wait_for_load", () => {
  it("validates surface and bounds the timeout", () => {
    const server = createFakeMcpServer();
    registerWaitForLoad(server.asMcpServer, () => ({}));
    const tool = getTool(server, "wait_for_load");
    expect(parseInput(tool, {}).success).toBe(false);
    expect(parseInput(tool, { surface: "main" }).success).toBe(true);
    expect(parseInput(tool, { surface: "main", timeoutMs: 0 }).success).toBe(
      false,
    );
    expect(
      parseInput(tool, { surface: "main", timeoutMs: 60_001 }).success,
    ).toBe(false);
  });

  it("short-circuits when no load is in progress", async () => {
    const server = createFakeMcpServer();
    const wc = createFakeWebContents({ isLoading: false });
    const win = createFakeBrowserWindow({ webContents: wc });
    registerWaitForLoad(server.asMcpServer, () => ({
      load_main: win.asBrowserWindow,
    }));
    const tool = getTool(server, "wait_for_load");
    const result = (await tool.handler({ surface: "load_main" })) as {
      structuredContent: { status: string };
    };
    expect(result.structuredContent.status).toBe("already-loaded");
  });

  it("rejects with a load-failure description when did-fail-load fires on the main frame", async () => {
    const server = createFakeMcpServer();
    const wc = createFakeWebContents({ isLoading: true });
    const win = createFakeBrowserWindow({ webContents: wc });
    registerWaitForLoad(server.asMcpServer, () => ({
      load_err: win.asBrowserWindow,
    }));
    const tool = getTool(server, "wait_for_load");

    const promise = tool.handler({ surface: "load_err" });
    // Trigger the failure synchronously after handler subscribed.
    await Promise.resolve();
    wc.emit("did-fail-load", {}, -100, "DNS_FAILURE", "http://x", true);
    await expect(promise).rejects.toThrow(/load failed.*DNS_FAILURE/);
  });
});
