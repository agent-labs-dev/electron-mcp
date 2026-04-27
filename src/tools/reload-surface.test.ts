import { describe, expect, it } from "vitest";
import {
  createFakeBrowserWindow,
  createFakeMcpServer,
  createFakeWebContents,
  getTool,
  parseInput,
} from "../testing";
import { registerReloadSurface } from "./reload-surface";

describe("reload_surface", () => {
  it("validates surface and timeout bounds", () => {
    const server = createFakeMcpServer();
    registerReloadSurface(server.asMcpServer, () => ({}));
    const tool = getTool(server, "reload_surface");
    expect(parseInput(tool, {}).success).toBe(false);
    expect(parseInput(tool, { surface: "main" }).success).toBe(true);
    expect(
      parseInput(tool, { surface: "main", ignoreCache: true }).success,
    ).toBe(true);
    expect(
      parseInput(tool, { surface: "main", timeoutMs: 60_001 }).success,
    ).toBe(false);
  });

  it("calls reload() and resolves on did-finish-load", async () => {
    const server = createFakeMcpServer();
    const wc = createFakeWebContents({ url: "http://app/" });
    const win = createFakeBrowserWindow({ webContents: wc });
    registerReloadSurface(server.asMcpServer, () => ({
      reload_main: win.asBrowserWindow,
    }));
    const tool = getTool(server, "reload_surface");

    const handler = tool.handler({ surface: "reload_main" });
    // Yield so subscriptions register before we emit the load completion.
    await Promise.resolve();
    wc.emit("did-finish-load");
    const result = (await handler) as {
      structuredContent: { ignoreCache: boolean; url: string };
    };
    expect(wc.reload).toHaveBeenCalledTimes(1);
    expect(wc.reloadIgnoringCache).not.toHaveBeenCalled();
    expect(result.structuredContent.ignoreCache).toBe(false);
    expect(result.structuredContent.url).toBe("http://app/");
  });

  it("uses reloadIgnoringCache when ignoreCache=true and rejects on did-fail-load", async () => {
    const server = createFakeMcpServer();
    const wc = createFakeWebContents();
    const win = createFakeBrowserWindow({ webContents: wc });
    registerReloadSurface(server.asMcpServer, () => ({
      reload_err: win.asBrowserWindow,
    }));
    const tool = getTool(server, "reload_surface");

    const handler = tool.handler({
      surface: "reload_err",
      ignoreCache: true,
    });
    await Promise.resolve();
    wc.emit("did-fail-load", {}, -105, "ADDRESS_UNREACHABLE", "x", true);
    await expect(handler).rejects.toThrow(/ADDRESS_UNREACHABLE/);
    expect(wc.reloadIgnoringCache).toHaveBeenCalledTimes(1);
  });
});
