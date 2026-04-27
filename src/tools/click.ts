import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getOrAttachSession } from "../cdp";
import { waitForSelector } from "../cdp-helpers";
import { resolveSurface, type SurfaceGetter } from "../surfaces";

const inputSchema = {
  surface: z.string().min(1).describe("Which surface to click in."),
  selector: z
    .string()
    .min(1)
    .describe(
      "CSS selector for the click target. Must match at least one " +
        "element; if multiple elements match, the first match is clicked.",
    ),
  button: z
    .enum(["left", "right", "middle"])
    .optional()
    .describe("Mouse button. Defaults to left."),
  clickCount: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Click count (2 = double-click). Defaults to 1."),
  timeoutMs: z
    .number()
    .int()
    .positive()
    .max(60_000)
    .optional()
    .describe("Wait-for-selector timeout in ms (1-60000). Defaults to 5000."),
};

export function registerClick(
  server: McpServer,
  getSurfaces: SurfaceGetter,
): void {
  server.registerTool(
    "click",
    {
      title: "Click element",
      description:
        "Click an element matching a CSS selector. Auto-waits up to " +
        "timeoutMs for the element to exist and have non-zero size before " +
        "dispatching a mousedown + mouseup at its center.",
      inputSchema,
    },
    async ({
      surface,
      selector,
      button = "left",
      clickCount = 1,
      timeoutMs = 5000,
    }) => {
      // Show the window: CDP dispatches regardless of visibility,
      // but a hidden window won't paint hover/layout state. We don't
      // focus here — `focus_surface` is the right tool for that.
      const win = resolveSurface(getSurfaces, surface);
      if (!win.isVisible()) win.show();

      const session = getOrAttachSession(getSurfaces, surface);
      const rect = await waitForSelector(session, selector, timeoutMs);

      const common = {
        x: rect.centerX,
        y: rect.centerY,
        button,
        clickCount,
      };
      await session.send("Input.dispatchMouseEvent", {
        ...common,
        type: "mousePressed",
      });
      await session.send("Input.dispatchMouseEvent", {
        ...common,
        type: "mouseReleased",
      });

      return {
        content: [
          {
            type: "text",
            text: `Clicked ${selector} on ${surface} at (${Math.round(rect.centerX)}, ${Math.round(rect.centerY)})`,
          },
        ],
        structuredContent: { surface, selector, rect, button, clickCount },
      };
    },
  );
}
