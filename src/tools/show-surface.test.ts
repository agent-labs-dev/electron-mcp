import { describe, expect, it } from "vitest";
import {
  createFakeBrowserWindow,
  createFakeMcpServer,
  getTool,
  parseInput,
} from "../testing";
import { registerShowSurface } from "./show-surface";

describe("show_surface", () => {
  it("rejects missing/empty surface and accepts arbitrary string keys", () => {
    const server = createFakeMcpServer();
    registerShowSurface(server.asMcpServer, () => ({}));
    const tool = getTool(server, "show_surface");

    expect(parseInput(tool, {}).success).toBe(false);
    expect(parseInput(tool, { surface: "" }).success).toBe(false);
    expect(parseInput(tool, { surface: "main" }).success).toBe(true);
    expect(
      parseInput(tool, { surface: "settings", focus: false }).success,
    ).toBe(true);
  });

  it("shows and focuses the resolved window by default", async () => {
    const server = createFakeMcpServer();
    const win = createFakeBrowserWindow({ visible: false, focused: false });
    registerShowSurface(server.asMcpServer, () => ({
      preview: win.asBrowserWindow,
    }));

    const tool = getTool(server, "show_surface");
    const result = (await tool.handler({ surface: "preview" })) as {
      structuredContent: {
        surface: string;
        visible: boolean;
        focused: boolean;
      };
    };
    expect(win.showCalls).toBe(1);
    expect(win.focusCalls).toBe(1);
    expect(result.structuredContent).toMatchObject({
      surface: "preview",
      visible: true,
      focused: true,
    });
  });

  it("skips focus when focus=false", async () => {
    const server = createFakeMcpServer();
    const win = createFakeBrowserWindow({ visible: false, focused: false });
    registerShowSurface(server.asMcpServer, () => ({
      preview: win.asBrowserWindow,
    }));

    const tool = getTool(server, "show_surface");
    await tool.handler({ surface: "preview", focus: false });
    expect(win.showCalls).toBe(1);
    expect(win.focusCalls).toBe(0);
  });

  it("throws when the surface is not registered", async () => {
    const server = createFakeMcpServer();
    registerShowSurface(server.asMcpServer, () => ({}));
    const tool = getTool(server, "show_surface");
    await expect(tool.handler({ surface: "ghost" })).rejects.toThrow(
      /surface "ghost" is not available/,
    );
  });
});
