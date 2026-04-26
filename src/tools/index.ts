// Generic MCP tool barrel — surface-agnostic, no app-specific
// callbacks. App-specific tools (`trigger_hotkey`, `trigger_tray_click`)
// live under `../app-tools/` and are registered by the consumer.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SurfaceGetter } from "../surfaces.js";
import { registerAxSnapshot } from "./ax-snapshot.js";
import { registerClick } from "./click.js";
import { registerEvaluate } from "./evaluate.js";
import { registerFillForm } from "./fill-form.js";
import { registerFocusSurface } from "./focus-surface.js";
import { registerHideSurface } from "./hide-surface.js";
import { registerHover } from "./hover.js";
import { registerListSurfaces } from "./list-surfaces.js";
import { registerPressKey } from "./press-key.js";
import { registerQueryDom } from "./query-dom.js";
import { registerReloadSurface } from "./reload-surface.js";
import { registerScreenshot } from "./screenshot.js";
import { registerShowSurface } from "./show-surface.js";
import { registerTypeText } from "./type-text.js";
import { registerWaitForLoad } from "./wait-for-load.js";

interface RegisterAllToolsOptions {
  getSurfaces: SurfaceGetter;
}

export function registerAllTools(
  server: McpServer,
  options: RegisterAllToolsOptions,
): void {
  const { getSurfaces } = options;

  registerListSurfaces(server, getSurfaces);
  registerShowSurface(server, getSurfaces);
  registerEvaluate(server, getSurfaces);
  registerScreenshot(server, getSurfaces);

  registerClick(server, getSurfaces);
  registerTypeText(server, getSurfaces);
  registerPressKey(server, getSurfaces);
  registerQueryDom(server, getSurfaces);
  registerAxSnapshot(server, getSurfaces);
  registerHideSurface(server, getSurfaces);
  registerFocusSurface(server, getSurfaces);

  registerHover(server, getSurfaces);
  registerFillForm(server, getSurfaces);
  registerReloadSurface(server, getSurfaces);
  registerWaitForLoad(server, getSurfaces);
}
