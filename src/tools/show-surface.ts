import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { resolveSurface, type SurfaceGetter } from "../surfaces";

const inputSchema = {
  surface: z.string().min(1).describe("Which surface to show."),
  focus: z
    .boolean()
    .optional()
    .describe(
      "Whether to focus the window after showing it. Defaults to true.",
    ),
};

export function registerShowSurface(
  server: McpServer,
  getSurfaces: SurfaceGetter,
): void {
  server.registerTool(
    "show_surface",
    {
      title: "Show surface",
      description: "Make a floating surface visible and (optionally) focus it.",
      inputSchema,
    },
    async ({ surface, focus = true }) => {
      const win = resolveSurface(getSurfaces, surface);
      win.show();

      if (focus) {
        win.focus();
      }
      // Sample after the optional focus() so `focus: false` still
      // reports the real state.
      const focused = win.isFocused();

      return {
        content: [
          {
            type: "text",
            text: `Shown ${surface}. visible=${win.isVisible()} focused=${focused}`,
          },
        ],
        structuredContent: {
          surface,
          visible: win.isVisible(),
          focused,
          focusable: win.isFocusable(),
        },
      };
    },
  );
}
