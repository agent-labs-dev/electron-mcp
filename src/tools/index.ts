// Generic MCP tool barrel: surface-agnostic, no app-specific callbacks.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { SurfaceGetter } from "../surfaces";
import { registerAxSnapshot } from "./ax-snapshot";
import { registerClick } from "./click";
import { registerEvaluate } from "./evaluate";
import { registerFillForm } from "./fill-form";
import { registerFocusSurface } from "./focus-surface";
import { registerHideSurface } from "./hide-surface";
import { registerHover } from "./hover";
import { registerListSurfaces } from "./list-surfaces";
import { registerPressKey } from "./press-key";
import { registerQueryDom } from "./query-dom";
import { registerReloadSurface } from "./reload-surface";
import { registerScreenshot } from "./screenshot";
import { registerShowSurface } from "./show-surface";
import { registerTypeText } from "./type-text";
import { registerWaitForLoad } from "./wait-for-load";

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
