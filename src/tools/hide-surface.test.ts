import { describe, expect, it } from "vitest";
import {
  createFakeBrowserWindow,
  createFakeMcpServer,
  getTool,
  parseInput,
} from "../testing";
import { registerHideSurface } from "./hide-surface";

describe("hide_surface", () => {
  it("requires a non-empty surface key", () => {
    const server = createFakeMcpServer();
    registerHideSurface(server.asMcpServer, () => ({}));
    const tool = getTool(server, "hide_surface");
    expect(parseInput(tool, {}).success).toBe(false);
    expect(parseInput(tool, { surface: "" }).success).toBe(false);
    expect(parseInput(tool, { surface: "popover" }).success).toBe(true);
  });

  it("hides the resolved window", async () => {
    const server = createFakeMcpServer();
    const win = createFakeBrowserWindow({ visible: true });
    registerHideSurface(server.asMcpServer, () => ({
      popover: win.asBrowserWindow,
    }));

    const tool = getTool(server, "hide_surface");
    const result = (await tool.handler({ surface: "popover" })) as {
      structuredContent: { surface: string; visible: boolean };
    };
    expect(win.hideCalls).toBe(1);
    expect(result.structuredContent).toEqual({
      surface: "popover",
      visible: false,
    });
  });

  it("throws when the surface is destroyed", async () => {
    const server = createFakeMcpServer();
    const win = createFakeBrowserWindow();
    win.__destroy();
    registerHideSurface(server.asMcpServer, () => ({
      popover: win.asBrowserWindow,
    }));
    const tool = getTool(server, "hide_surface");
    await expect(tool.handler({ surface: "popover" })).rejects.toThrow(
      /surface "popover" is not available/,
    );
  });
});
