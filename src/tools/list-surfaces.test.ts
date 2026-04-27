import { describe, expect, it } from "vitest";
import {
  createFakeBrowserWindow,
  createFakeMcpServer,
  getTool,
} from "../testing";
import { registerListSurfaces } from "./list-surfaces";

describe("list_surfaces", () => {
  it("registers a tool with no input schema", () => {
    const server = createFakeMcpServer();
    registerListSurfaces(server.asMcpServer, () => ({}));
    const tool = getTool(server, "list_surfaces");
    expect(tool.config.inputSchema).toBeUndefined();
    expect(tool.config.title).toBe("List surfaces");
  });

  it("describes every consumer-defined surface, sorted by key", async () => {
    const server = createFakeMcpServer();
    const main = createFakeBrowserWindow({
      visible: true,
      focused: true,
      bounds: { x: 10, y: 20, width: 300, height: 200 },
    });
    const settings = createFakeBrowserWindow({ visible: false });
    registerListSurfaces(server.asMcpServer, () => ({
      // order chosen to verify the impl sorts.
      settings: settings.asBrowserWindow,
      main: main.asBrowserWindow,
    }));

    const tool = getTool(server, "list_surfaces");
    const result = (await tool.handler({})) as {
      structuredContent: { surfaces: Array<{ surface: string }> };
    };
    expect(result.structuredContent.surfaces.map((s) => s.surface)).toEqual([
      "main",
      "settings",
    ]);
    expect(result.structuredContent.surfaces[0]).toMatchObject({
      surface: "main",
      present: true,
      visible: true,
      focused: true,
      bounds: { x: 10, y: 20, width: 300, height: 200 },
    });
  });

  it("reports destroyed or null surfaces as { present: false }", async () => {
    const server = createFakeMcpServer();
    const dead = createFakeBrowserWindow();
    dead.__destroy();
    registerListSurfaces(server.asMcpServer, () => ({
      dead: dead.asBrowserWindow,
      missing: null,
    }));

    const tool = getTool(server, "list_surfaces");
    const result = (await tool.handler({})) as {
      structuredContent: {
        surfaces: Array<{ surface: string; present: boolean }>;
      };
    };
    expect(result.structuredContent.surfaces).toEqual([
      { surface: "dead", present: false },
      { surface: "missing", present: false },
    ]);
  });
});
