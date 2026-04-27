import { afterEach, describe, expect, it } from "vitest";
import { detachAll } from "../cdp";
import {
  createFakeBrowserWindow,
  createFakeMcpServer,
  createFakeWebContents,
  getTool,
  parseInput,
} from "../testing";
import { registerFillForm } from "./fill-form";

afterEach(() => detachAll());

describe("fill_form", () => {
  it("validates surface + at-least-one field", () => {
    const server = createFakeMcpServer();
    registerFillForm(server.asMcpServer, () => ({}));
    const tool = getTool(server, "fill_form");
    expect(parseInput(tool, { surface: "main", fields: [] }).success).toBe(
      false,
    );
    expect(
      parseInput(tool, {
        surface: "main",
        fields: [{ selector: "#a", value: "1" }],
      }).success,
    ).toBe(true);
    expect(
      parseInput(tool, {
        surface: "main",
        fields: [{ selector: "", value: "1" }],
      }).success,
    ).toBe(false);
  });

  it("fills each field in order via insertText", async () => {
    const server = createFakeMcpServer();
    // Sequence of Runtime.evaluate calls per field:
    //   1) waitForSelector → rect
    //   2) focus assertion → { ok: true }
    //   3) clearFirst select → { ok: true }
    let evalCall = 0;
    const wc = createFakeWebContents({
      cdp: {
        "Runtime.evaluate": () => {
          evalCall += 1;
          const phase = ((evalCall - 1) % 3) + 1;
          if (phase === 1) {
            return {
              result: {
                type: "object",
                value: { x: 0, y: 0, width: 60, height: 24 },
              },
            };
          }
          return {
            result: { type: "object", value: { ok: true } },
          };
        },
      },
    });
    const win = createFakeBrowserWindow({ visible: false, webContents: wc });
    registerFillForm(server.asMcpServer, () => ({
      ff_main: win.asBrowserWindow,
    }));
    const tool = getTool(server, "fill_form");
    const result = (await tool.handler({
      surface: "ff_main",
      fields: [
        { selector: "#email", value: "a@b" },
        { selector: "#name", value: "Ada" },
      ],
    })) as { structuredContent: { filledCount: number } };
    expect(result.structuredContent.filledCount).toBe(2);
    const inserts = wc.cdpCalls
      .filter((c) => c.method === "Input.insertText")
      .map((c) => c.params?.text);
    expect(inserts).toEqual(["a@b", "Ada"]);
  });

  it("fails fast with the failing field index when focus assertion returns ok=false", async () => {
    const server = createFakeMcpServer();
    let evalCall = 0;
    const wc = createFakeWebContents({
      cdp: {
        "Runtime.evaluate": () => {
          evalCall += 1;
          if (evalCall === 1) {
            return {
              result: {
                type: "object",
                value: { x: 0, y: 0, width: 60, height: 24 },
              },
            };
          }
          // Focus did not land on the target.
          return {
            result: {
              type: "object",
              value: { ok: false, reason: "intercepted by overlay" },
            },
          };
        },
      },
    });
    const win = createFakeBrowserWindow({ webContents: wc });
    registerFillForm(server.asMcpServer, () => ({
      ff_err: win.asBrowserWindow,
    }));
    const tool = getTool(server, "fill_form");
    const result = (await tool.handler({
      surface: "ff_err",
      fields: [{ selector: "#blocked", value: "x" }],
    })) as {
      isError: boolean;
      structuredContent: { failedIndex: number; filledCount: number };
    };
    expect(result.isError).toBe(true);
    expect(result.structuredContent.failedIndex).toBe(0);
    expect(result.structuredContent.filledCount).toBe(0);
  });
});
