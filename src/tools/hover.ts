import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getOrAttachSession } from "../cdp.js";
import { waitForSelector } from "../cdp-helpers.js";
import { resolveSurface, type SurfaceGetter } from "../surfaces.js";

const inputSchema = {
  surface: z.string().min(1).describe("Which surface to hover in."),
  selector: z
    .string()
    .min(1)
    .describe(
      "CSS selector for the hover target. Must match at least one " +
        "element; if multiple elements match, the first match is hovered.",
    ),
  timeoutMs: z
    .number()
    .int()
    .positive()
    .max(60_000)
    .optional()
    .describe("Wait-for-selector timeout in ms (1-60000). Defaults to 5000."),
};

export function registerHover(
  server: McpServer,
  getSurfaces: SurfaceGetter,
): void {
  server.registerTool(
    "hover",
    {
      title: "Hover element",
      description:
        "Move the cursor over an element matching a CSS selector. Fires " +
        "mouseenter/mouseover events at the element center. Useful for " +
        "revealing tooltips and dropdowns before inspecting them.",
      inputSchema,
    },
    async ({ surface, selector, timeoutMs = 5000 }) => {
      // Show the window — hover UI won't paint on a hidden window.
      const win = resolveSurface(getSurfaces, surface);
      if (!win.isVisible()) win.show();

      const session = getOrAttachSession(getSurfaces, surface);
      const rect = await waitForSelector(session, selector, timeoutMs);

      await session.send("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: rect.centerX,
        y: rect.centerY,
      });

      return {
        content: [
          {
            type: "text",
            text: `Hovered ${selector} on ${surface} at (${Math.round(rect.centerX)}, ${Math.round(rect.centerY)})`,
          },
        ],
        structuredContent: { surface, selector, rect },
      };
    },
  );
}
