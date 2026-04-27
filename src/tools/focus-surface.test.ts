import { describe, expect, it } from "vitest";
import {
  createFakeBrowserWindow,
  createFakeMcpServer,
  getTool,
  parseInput,
} from "../testing";
import { registerFocusSurface } from "./focus-surface";

describe("focus_surface", () => {
  it("requires a non-empty surface key", () => {
    const server = createFakeMcpServer();
    registerFocusSurface(server.asMcpServer, () => ({}));
    const tool = getTool(server, "focus_surface");
    expect(parseInput(tool, {}).success).toBe(false);
    expect(parseInput(tool, { surface: "" }).success).toBe(false);
    expect(parseInput(tool, { surface: "main" }).success).toBe(true);
  });

  it("focuses a focusable window", async () => {
    const server = createFakeMcpServer();
    const win = createFakeBrowserWindow({
      visible: true,
      focused: false,
      focusable: true,
    });
    registerFocusSurface(server.asMcpServer, () => ({
      main: win.asBrowserWindow,
    }));
    const tool = getTool(server, "focus_surface");
    const result = (await tool.handler({ surface: "main" })) as {
      isError?: boolean;
      structuredContent: { focused: boolean; focusable: boolean };
    };
    expect(result.isError).toBeUndefined();
    expect(win.focusCalls).toBe(1);
    expect(result.structuredContent).toMatchObject({
      focused: true,
      focusable: true,
    });
  });

  it("returns an error result without calling focus() when non-focusable", async () => {
    const server = createFakeMcpServer();
    const win = createFakeBrowserWindow({ focusable: false });
    registerFocusSurface(server.asMcpServer, () => ({
      main: win.asBrowserWindow,
    }));
    const tool = getTool(server, "focus_surface");
    const result = (await tool.handler({ surface: "main" })) as {
      isError: boolean;
      structuredContent: { focused: boolean; focusable: boolean };
    };
    expect(result.isError).toBe(true);
    expect(win.focusCalls).toBe(0);
    expect(result.structuredContent).toMatchObject({
      focused: false,
      focusable: false,
    });
  });
});
