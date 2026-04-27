import { afterEach, describe, expect, it } from "vitest";
import { detachAll } from "../cdp";
import {
  createFakeBrowserWindow,
  createFakeMcpServer,
  createFakeWebContents,
  getTool,
  parseInput,
} from "../testing";
import { registerClick } from "./click";

afterEach(() => detachAll());

function rectResponse(x: number, y: number, width: number, height: number) {
  return {
    result: { type: "object", value: { x, y, width, height } },
  };
}

describe("click", () => {
  it("requires non-empty surface + selector", () => {
    const server = createFakeMcpServer();
    registerClick(server.asMcpServer, () => ({}));
    const tool = getTool(server, "click");
    expect(parseInput(tool, { surface: "main" }).success).toBe(false);
    expect(parseInput(tool, { selector: "#go" }).success).toBe(false);
    expect(parseInput(tool, { surface: "main", selector: "" }).success).toBe(
      false,
    );
    expect(parseInput(tool, { surface: "main", selector: "#go" }).success).toBe(
      true,
    );
  });

  it("dispatches mousePressed + mouseReleased at the element center", async () => {
    const server = createFakeMcpServer();
    const wc = createFakeWebContents({
      cdp: {
        "Runtime.evaluate": rectResponse(40, 60, 100, 40),
      },
    });
    const win = createFakeBrowserWindow({ visible: false, webContents: wc });
    registerClick(server.asMcpServer, () => ({
      click_main: win.asBrowserWindow,
    }));

    const tool = getTool(server, "click");
    const result = (await tool.handler({
      surface: "click_main",
      selector: "#go",
    })) as {
      structuredContent: { rect: { centerX: number; centerY: number } };
    };

    // hidden window is auto-shown
    expect(win.showCalls).toBe(1);
    expect(result.structuredContent.rect.centerX).toBe(90);
    expect(result.structuredContent.rect.centerY).toBe(80);
    const dispatched = wc.cdpCalls
      .filter((c) => c.method === "Input.dispatchMouseEvent")
      .map((c) => c.params?.type);
    expect(dispatched).toEqual(["mousePressed", "mouseReleased"]);
  });

  it("propagates a renderer exception from the selector wait", async () => {
    const server = createFakeMcpServer();
    const wc = createFakeWebContents({
      cdp: {
        "Runtime.evaluate": () => ({
          result: { type: "object" },
          exceptionDetails: {
            text: "SyntaxError: bad selector",
            exception: { description: "SyntaxError: bad selector" },
          },
        }),
      },
    });
    const win = createFakeBrowserWindow({ webContents: wc });
    registerClick(server.asMcpServer, () => ({
      click_err: win.asBrowserWindow,
    }));
    const tool = getTool(server, "click");
    await expect(
      tool.handler({
        surface: "click_err",
        selector: ":::not-a-selector",
        timeoutMs: 50,
      }),
    ).rejects.toThrow(/SyntaxError/);
  });
});
