import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { resolveSurface, type SurfaceGetter } from "../surfaces.js";

const inputSchema = {
  surface: z.string().min(1).describe("Which surface to focus."),
};

export function registerFocusSurface(
  server: McpServer,
  getSurfaces: SurfaceGetter,
): void {
  server.registerTool(
    "focus_surface",
    {
      title: "Focus surface",
      description:
        "Give keyboard focus to a floating surface. Returns an explicit " +
        "error if the window is currently non-focusable rather than a " +
        "silent no-op.",
      inputSchema,
    },
    async ({ surface }) => {
      const win = resolveSurface(getSurfaces, surface);

      if (!win.isFocusable()) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Surface "${surface}" is currently non-focusable; focus call ignored.`,
            },
          ],
          structuredContent: {
            surface,
            focused: false,
            focusable: false,
            visible: win.isVisible(),
          },
        };
      }

      win.focus();
      return {
        content: [
          {
            type: "text",
            text: `Focused ${surface}. focused=${win.isFocused()}`,
          },
        ],
        structuredContent: {
          surface,
          focused: win.isFocused(),
          focusable: true,
          visible: win.isVisible(),
        },
      };
    },
  );
}
