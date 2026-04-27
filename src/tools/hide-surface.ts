import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { resolveSurface, type SurfaceGetter } from "../surfaces";

const inputSchema = {
  surface: z.string().min(1).describe("Which surface to hide."),
};

export function registerHideSurface(
  server: McpServer,
  getSurfaces: SurfaceGetter,
): void {
  server.registerTool(
    "hide_surface",
    {
      title: "Hide surface",
      description:
        "Hide a floating surface. No-op if already hidden. Pairs with " +
        "show_surface.",
      inputSchema,
    },
    async ({ surface }) => {
      const win = resolveSurface(getSurfaces, surface);
      win.hide();
      return {
        content: [
          {
            type: "text",
            text: `Hidden ${surface}. visible=${win.isVisible()}`,
          },
        ],
        structuredContent: { surface, visible: win.isVisible() },
      };
    },
  );
}
