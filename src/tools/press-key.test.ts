import { afterEach, describe, expect, it } from "vitest";
import { detachAll } from "../cdp";
import {
  createFakeBrowserWindow,
  createFakeMcpServer,
  createFakeWebContents,
  getTool,
  parseInput,
} from "../testing";
import { registerPressKey } from "./press-key";

afterEach(() => detachAll());

describe("press_key", () => {
  it("validates surface + key and modifier whitelist", () => {
    const server = createFakeMcpServer();
    registerPressKey(server.asMcpServer, () => ({}));
    const tool = getTool(server, "press_key");
    expect(parseInput(tool, { surface: "main", key: "Enter" }).success).toBe(
      true,
    );
    expect(
      parseInput(tool, {
        surface: "main",
        key: "a",
        modifiers: ["cmd", "shift"],
      }).success,
    ).toBe(true);
    expect(
      parseInput(tool, {
        surface: "main",
        key: "a",
        modifiers: ["super"],
      }).success,
    ).toBe(false);
    expect(parseInput(tool, { surface: "main", key: "" }).success).toBe(false);
  });

  it("dispatches keyDown + keyUp with normalised modifiers", async () => {
    const server = createFakeMcpServer();
    const wc = createFakeWebContents({});
    const win = createFakeBrowserWindow({ webContents: wc });
    registerPressKey(server.asMcpServer, () => ({
      press_main: win.asBrowserWindow,
    }));
    const tool = getTool(server, "press_key");
    const result = (await tool.handler({
      surface: "press_main",
      key: "Enter",
      modifiers: ["cmd", "command"], // duplicate alias collapses to `cmd`
    })) as { structuredContent: { modifiers: string[] } };
    expect(result.structuredContent.modifiers).toEqual(["cmd"]);
    const types = wc.cdpCalls
      .filter((c) => c.method === "Input.dispatchKeyEvent")
      .map((c) => c.params?.type);
    expect(types).toEqual(["keyDown", "keyUp"]);
  });

  it("throws on unsupported keys", async () => {
    const server = createFakeMcpServer();
    const wc = createFakeWebContents({});
    const win = createFakeBrowserWindow({ webContents: wc });
    registerPressKey(server.asMcpServer, () => ({
      press_err: win.asBrowserWindow,
    }));
    const tool = getTool(server, "press_key");
    await expect(
      tool.handler({ surface: "press_err", key: "F13" }),
    ).rejects.toThrow(/unsupported key/);
  });
});
