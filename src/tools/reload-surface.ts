import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { resolveSurface, type SurfaceGetter } from "../surfaces.js";
import { awaitNextLoad } from "./wait-for-load.js";

const inputSchema = {
  surface: z.string().min(1).describe("Which surface to reload."),
  ignoreCache: z
    .boolean()
    .optional()
    .describe(
      "If true, bypass the HTTP cache (maps to reloadIgnoringCache). " +
        "Defaults to false — Vite's dev server rarely serves stale content.",
    ),
  timeoutMs: z
    .number()
    .int()
    .positive()
    .max(60_000)
    .optional()
    .describe("Max wait for did-finish-load (1-60000 ms). Defaults to 10000."),
};

export function registerReloadSurface(
  server: McpServer,
  getSurfaces: SurfaceGetter,
): void {
  server.registerTool(
    "reload_surface",
    {
      title: "Reload surface",
      description:
        "Reload a surface's renderer and wait for did-finish-load. Blocks " +
        "until the new load completes so subsequent tools see the fresh " +
        "renderer. Use ignoreCache to bypass the HTTP cache.",
      inputSchema,
    },
    async ({ surface, ignoreCache = false, timeoutMs = 10_000 }) => {
      const win = resolveSurface(getSurfaces, surface);
      const wc = win.webContents;

      const result = await awaitNextLoad(
        wc,
        () => {
          if (ignoreCache) wc.reloadIgnoringCache();
          else wc.reload();
        },
        timeoutMs,
      );

      return {
        content: [
          {
            type: "text",
            text: `Reloaded ${surface} in ${result.durationMs}ms (ignoreCache=${ignoreCache})`,
          },
        ],
        structuredContent: {
          surface,
          ignoreCache,
          durationMs: result.durationMs,
          url: wc.getURL(),
        },
      };
    },
  );
}
