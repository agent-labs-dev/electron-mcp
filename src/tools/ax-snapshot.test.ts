import { afterEach, describe, expect, it } from "vitest";
import { detachAll } from "../cdp";
import {
  createFakeBrowserWindow,
  createFakeMcpServer,
  createFakeWebContents,
  getTool,
  parseInput,
} from "../testing";
import { registerAxSnapshot } from "./ax-snapshot";

afterEach(() => detachAll());

describe("get_ax_snapshot", () => {
  it("validates surface and rejects an empty root selector", () => {
    const server = createFakeMcpServer();
    registerAxSnapshot(server.asMcpServer, () => ({}));
    const tool = getTool(server, "get_ax_snapshot");
    expect(parseInput(tool, {}).success).toBe(false);
    expect(parseInput(tool, { surface: "main", root: "" }).success).toBe(false);
    expect(parseInput(tool, { surface: "main" }).success).toBe(true);
    expect(parseInput(tool, { surface: "main", root: "#app" }).success).toBe(
      true,
    );
  });

  it("returns the full AX tree, filtering ignored nodes by default", async () => {
    const server = createFakeMcpServer();
    const wc = createFakeWebContents({
      cdp: {
        "Accessibility.enable": {},
        "Accessibility.disable": {},
        "Accessibility.getFullAXTree": {
          nodes: [
            {
              nodeId: "1",
              role: { value: "button" },
              name: { value: "Go" },
              childIds: ["2"],
            },
            { nodeId: "2", ignored: true },
          ],
        },
      },
    });
    const win = createFakeBrowserWindow({ webContents: wc });
    registerAxSnapshot(server.asMcpServer, () => ({
      ax_main: win.asBrowserWindow,
    }));
    const tool = getTool(server, "get_ax_snapshot");
    const result = (await tool.handler({ surface: "ax_main" })) as {
      structuredContent: { nodes: Array<{ id: string; children: string[] }> };
    };
    // Ignored child filtered out + child reference scrubbed.
    expect(result.structuredContent.nodes).toHaveLength(1);
    expect(result.structuredContent.nodes[0]).toMatchObject({
      id: "1",
      children: [],
    });
  });

  it("returns isError when the root selector cannot be resolved", async () => {
    const server = createFakeMcpServer();
    const wc = createFakeWebContents({
      cdp: {
        "Accessibility.enable": {},
        "Accessibility.disable": {},
        "Runtime.evaluate": { result: { type: "object" } }, // no objectId
      },
    });
    const win = createFakeBrowserWindow({ webContents: wc });
    registerAxSnapshot(server.asMcpServer, () => ({
      ax_err: win.asBrowserWindow,
    }));
    const tool = getTool(server, "get_ax_snapshot");
    const result = (await tool.handler({
      surface: "ax_err",
      root: "#missing",
    })) as { isError: boolean; content: Array<{ text: string }> };
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/root selector not resolvable/);
  });
});
