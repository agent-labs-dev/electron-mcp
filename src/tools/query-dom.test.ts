import { afterEach, describe, expect, it } from "vitest";
import { detachAll } from "../cdp";
import {
  createFakeBrowserWindow,
  createFakeMcpServer,
  createFakeWebContents,
  getTool,
  parseInput,
} from "../testing";
import { registerQueryDom } from "./query-dom";

afterEach(() => detachAll());

describe("query_dom", () => {
  it("validates surface + selector and bounds limit/attrs", () => {
    const server = createFakeMcpServer();
    registerQueryDom(server.asMcpServer, () => ({}));
    const tool = getTool(server, "query_dom");
    expect(parseInput(tool, { surface: "main" }).success).toBe(false);
    expect(parseInput(tool, { surface: "main", selector: "" }).success).toBe(
      false,
    );
    expect(
      parseInput(tool, { surface: "main", selector: "*", limit: 0 }).success,
    ).toBe(false);
    expect(
      parseInput(tool, { surface: "main", selector: "*", limit: 201 }).success,
    ).toBe(false);
    expect(
      parseInput(tool, {
        surface: "main",
        selector: "*",
        attrs: new Array(21).fill("a"),
      }).success,
    ).toBe(false);
    expect(parseInput(tool, { surface: "main", selector: "*" }).success).toBe(
      true,
    );
  });

  it("returns matches and reports truncation when totalFound > matches.length", async () => {
    const server = createFakeMcpServer();
    const matches = [
      {
        tag: "button",
        text: "Go",
        attrs: { id: "go" },
        rect: { x: 0, y: 0, width: 40, height: 20 },
        visible: true,
      },
    ];
    const wc = createFakeWebContents({
      cdp: {
        "Runtime.evaluate": {
          result: { type: "object", value: { totalFound: 5, matches } },
        },
      },
    });
    const win = createFakeBrowserWindow({ webContents: wc });
    registerQueryDom(server.asMcpServer, () => ({
      query_main: win.asBrowserWindow,
    }));
    const tool = getTool(server, "query_dom");
    const result = (await tool.handler({
      surface: "query_main",
      selector: "button",
      limit: 1,
    })) as {
      structuredContent: {
        matches: unknown[];
        totalFound: number;
        truncated: boolean;
      };
    };
    expect(result.structuredContent.totalFound).toBe(5);
    expect(result.structuredContent.matches.length).toBe(1);
    expect(result.structuredContent.truncated).toBe(true);
  });

  it("returns isError when the renderer evaluate throws", async () => {
    const server = createFakeMcpServer();
    const wc = createFakeWebContents({
      cdp: {
        "Runtime.evaluate": {
          result: { type: "object" },
          exceptionDetails: {
            text: "DOMException: bad selector",
            exception: { description: "DOMException: bad selector" },
          },
        },
      },
    });
    const win = createFakeBrowserWindow({ webContents: wc });
    registerQueryDom(server.asMcpServer, () => ({
      query_err: win.asBrowserWindow,
    }));
    const tool = getTool(server, "query_dom");
    const result = (await tool.handler({
      surface: "query_err",
      selector: "::bad",
    })) as { isError: boolean; content: Array<{ text: string }> };
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/DOMException/);
  });
});
