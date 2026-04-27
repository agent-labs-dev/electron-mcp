// `webContents.capturePage()` (not CDP `Page.captureScreenshot`):
// no debugger attach, transparent regions stay transparent, PNG is
// byte-deterministic across runs.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { resolveSurface, type SurfaceGetter } from "../surfaces";

const rectSchema = z.object({
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

const inputSchema = {
  surface: z.string().min(1).describe("Which surface to screenshot."),
  rect: rectSchema
    .optional()
    .describe(
      "Optional crop rectangle in renderer CSS pixels (relative to the " +
        "surface's content area). Omit to capture the whole surface.",
    ),
};

export function registerScreenshot(
  server: McpServer,
  getSurfaces: SurfaceGetter,
): void {
  server.registerTool(
    "screenshot",
    {
      title: "Screenshot surface",
      description:
        "Capture a PNG of a floating surface's rendered content. Returns " +
        "an image content block Claude can view directly. Transparent " +
        "regions stay transparent (no OS compositor backdrop).",
      inputSchema,
    },
    async ({ surface, rect }) => {
      const win = resolveSurface(getSurfaces, surface);
      const image = rect
        ? await win.webContents.capturePage(rect)
        : await win.webContents.capturePage();

      // Empty NativeImage = the webContents hasn't painted yet.
      if (image.isEmpty()) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text:
                `Surface "${surface}" captured as an empty image — the renderer ` +
                `probably hasn't painted yet. Call show_surface first, or ` +
                `await a DOM-ready signal via evaluate before retrying.`,
            },
          ],
        };
      }

      const png = image.toPNG();
      const size = image.getSize();

      return {
        content: [
          {
            type: "image",
            mimeType: "image/png",
            data: png.toString("base64"),
          },
          {
            type: "text",
            text: `${surface}: ${size.width}×${size.height} px, ${png.byteLength} bytes`,
          },
        ],
        structuredContent: {
          surface,
          width: size.width,
          height: size.height,
          byteLength: png.byteLength,
        },
      };
    },
  );
}
