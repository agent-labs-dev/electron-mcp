import { afterEach, describe, expect, it } from "vitest";
import { detachAll } from "../cdp";
import {
  createFakeBrowserWindow,
  createFakeMcpServer,
  createFakeWebContents,
  getTool,
  parseInput,
} from "../testing";
import { registerEvaluate } from "./evaluate";

afterEach(() => detachAll());

describe("evaluate", () => {
  it("validates the surface + expression and bounds the timeout", () => {
    const server = createFakeMcpServer();
    registerEvaluate(server.asMcpServer, () => ({}));
    const tool = getTool(server, "evaluate");
    expect(parseInput(tool, { expression: "1+1" }).success).toBe(false);
    expect(parseInput(tool, { surface: "main" }).success).toBe(false);
    expect(
      parseInput(tool, { surface: "main", expression: "1+1" }).success,
    ).toBe(true);
    expect(
      parseInput(tool, {
        surface: "main",
        expression: "x",
        timeoutMs: 0,
      }).success,
    ).toBe(false);
    expect(
      parseInput(tool, {
        surface: "main",
        expression: "x",
        timeoutMs: 99_999,
      }).success,
    ).toBe(false);
  });

  it("returns the evaluated value as text when no exception is thrown", async () => {
    const server = createFakeMcpServer();
    const wc = createFakeWebContents({
      cdp: {
        "Runtime.evaluate": (params: Record<string, unknown>) => {
          expect(params).toMatchObject({
            expression: "1+1",
            returnByValue: true,
          });
          return { result: { type: "number", value: 2 } };
        },
      },
    });
    const win = createFakeBrowserWindow({ webContents: wc });
    registerEvaluate(server.asMcpServer, () => ({
      eval_main: win.asBrowserWindow,
    }));
    const tool = getTool(server, "evaluate");
    const result = (await tool.handler({
      surface: "eval_main",
      expression: "1+1",
    })) as { content: Array<{ text: string }> };
    expect(result.content[0].text).toBe("2");
  });

  it("returns isError when the renderer throws", async () => {
    const server = createFakeMcpServer();
    const wc = createFakeWebContents({
      cdp: {
        "Runtime.evaluate": () => ({
          result: { type: "object" },
          exceptionDetails: {
            exceptionId: 1,
            text: "boom",
            lineNumber: 4,
            columnNumber: 12,
            exception: { description: "ReferenceError: foo is not defined" },
          },
        }),
      },
    });
    const win = createFakeBrowserWindow({ webContents: wc });
    registerEvaluate(server.asMcpServer, () => ({
      eval_err: win.asBrowserWindow,
    }));
    const tool = getTool(server, "evaluate");
    const result = (await tool.handler({
      surface: "eval_err",
      expression: "foo()",
    })) as { isError: boolean; content: Array<{ text: string }> };
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/4:12/);
    expect(result.content[0].text).toMatch(/ReferenceError/);
  });
});
