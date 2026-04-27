import { afterEach, describe, expect, it } from "vitest";
import { detachAll } from "../cdp";
import {
  createFakeBrowserWindow,
  createFakeMcpServer,
  createFakeWebContents,
  getTool,
  parseInput,
} from "../testing";
import { registerTypeText } from "./type-text";

afterEach(() => detachAll());

describe("type_text", () => {
  it("validates surface + text and rejects empty selector", () => {
    const server = createFakeMcpServer();
    registerTypeText(server.asMcpServer, () => ({}));
    const tool = getTool(server, "type_text");
    expect(parseInput(tool, { surface: "main", text: "hi" }).success).toBe(
      true,
    );
    expect(
      parseInput(tool, { surface: "main", text: "hi", selector: "" }).success,
    ).toBe(false);
    expect(parseInput(tool, { surface: "main" }).success).toBe(false);
    expect(parseInput(tool, { text: "hi" }).success).toBe(false);
  });

  it("dispatches Input.insertText to the focused element when no selector is given", async () => {
    const server = createFakeMcpServer();
    const wc = createFakeWebContents({ cdp: {} });
    const win = createFakeBrowserWindow({ webContents: wc });
    registerTypeText(server.asMcpServer, () => ({
      type_main: win.asBrowserWindow,
    }));
    const tool = getTool(server, "type_text");
    const result = (await tool.handler({
      surface: "type_main",
      text: "hello",
    })) as { structuredContent: { charsTyped: number } };
    expect(result.structuredContent.charsTyped).toBe(5);
    expect(wc.cdpCalls).toEqual([
      { method: "Input.insertText", params: { text: "hello" } },
    ]);
  });

  it("throws when a selector is given but focus does not land on the element", async () => {
    let evalCall = 0;
    const server = createFakeMcpServer();
    const wc = createFakeWebContents({
      cdp: {
        "Runtime.evaluate": () => {
          evalCall += 1;
          // First call: waitForSelector — return a visible rect.
          if (evalCall === 1) {
            return {
              result: {
                type: "object",
                value: { x: 0, y: 0, width: 50, height: 20 },
              },
            };
          }
          // Second call: focus assertion — return false (focus didn't land).
          return { result: { type: "boolean", value: false } };
        },
      },
    });
    const win = createFakeBrowserWindow({ webContents: wc });
    registerTypeText(server.asMcpServer, () => ({
      type_err: win.asBrowserWindow,
    }));
    const tool = getTool(server, "type_text");
    await expect(
      tool.handler({
        surface: "type_err",
        text: "hi",
        selector: "#no-focus",
      }),
    ).rejects.toThrow(/could not focus selector/);
  });
});
