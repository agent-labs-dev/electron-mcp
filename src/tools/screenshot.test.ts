import { describe, expect, it } from "vitest";
import {
  createFakeBrowserWindow,
  createFakeImage,
  createFakeMcpServer,
  createFakeWebContents,
  getTool,
  parseInput,
} from "../testing";
import { registerScreenshot } from "./screenshot";

describe("screenshot", () => {
  it("validates surface and optional rect", () => {
    const server = createFakeMcpServer();
    registerScreenshot(server.asMcpServer, () => ({}));
    const tool = getTool(server, "screenshot");
    expect(parseInput(tool, {}).success).toBe(false);
    expect(parseInput(tool, { surface: "" }).success).toBe(false);
    expect(parseInput(tool, { surface: "main" }).success).toBe(true);
    expect(
      parseInput(tool, {
        surface: "main",
        rect: { x: 0, y: 0, width: 0, height: 10 },
      }).success,
    ).toBe(false);
    expect(
      parseInput(tool, {
        surface: "main",
        rect: { x: 0, y: 0, width: 100, height: 50 },
      }).success,
    ).toBe(true);
  });

  it("returns the captured PNG as base64 image content", async () => {
    const server = createFakeMcpServer();
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const wc = createFakeWebContents({
      capturePage: async () =>
        createFakeImage({ png, width: 200, height: 100 }),
    });
    const win = createFakeBrowserWindow({ webContents: wc });
    registerScreenshot(server.asMcpServer, () => ({
      main: win.asBrowserWindow,
    }));
    const tool = getTool(server, "screenshot");
    const result = (await tool.handler({ surface: "main" })) as {
      content: Array<{ type: string; data?: string }>;
      structuredContent: { width: number; height: number; byteLength: number };
    };
    expect(result.content[0].type).toBe("image");
    expect(result.content[0].data).toBe(png.toString("base64"));
    expect(result.structuredContent).toMatchObject({
      width: 200,
      height: 100,
      byteLength: png.byteLength,
    });
  });

  it("returns isError when the captured image is empty", async () => {
    const server = createFakeMcpServer();
    const wc = createFakeWebContents({
      capturePage: async () => createFakeImage({ empty: true }),
    });
    const win = createFakeBrowserWindow({ webContents: wc });
    registerScreenshot(server.asMcpServer, () => ({
      main: win.asBrowserWindow,
    }));
    const tool = getTool(server, "screenshot");
    const result = (await tool.handler({ surface: "main" })) as {
      isError: boolean;
      content: Array<{ type: string; text: string }>;
    };
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/empty image/);
  });
});
