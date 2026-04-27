// Pure main-process inspection — no CDP attach. Destroyed surfaces
// are reported as `present: false` (not omitted) so the agent sees
// "missing" instead of silently inferring it.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SurfaceGetter } from "../surfaces";

export function registerListSurfaces(
  server: McpServer,
  getSurfaces: SurfaceGetter,
): void {
  server.registerTool(
    "list_surfaces",
    {
      title: "List surfaces",
      description:
        "Enumerate every floating surface registered by the consumer with " +
        "its current visibility, focused state, screen bounds, and " +
        "webContents id. Use this to discover which surfaces are live " +
        "before calling any other tool.",
    },
    async () => {
      const surfaces = getSurfaces();
      const entries = Object.keys(surfaces)
        .sort()
        .map((name) => describeSurface(name, surfaces[name] ?? null));
      return {
        content: [{ type: "text", text: JSON.stringify(entries, null, 2) }],
        structuredContent: { surfaces: entries },
      };
    },
  );
}

function describeSurface(name: string, win: Electron.BrowserWindow | null) {
  if (!win || win.isDestroyed()) {
    return { surface: name, present: false } as const;
  }
  const bounds = win.getBounds();
  return {
    surface: name,
    present: true,
    visible: win.isVisible(),
    focused: win.isFocused(),
    focusable: win.isFocusable(),
    alwaysOnTop: win.isAlwaysOnTop(),
    bounds,
    webContentsId: win.webContents.id,
    url: win.webContents.getURL(),
    devToolsOpen: win.webContents.isDevToolsOpened(),
  } as const;
}
