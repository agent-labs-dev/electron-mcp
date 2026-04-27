// Surface resolution for MCP tools. Uses an injected `getSurfaces()`
// closure so the consumer owns the surface namespace — keys are
// arbitrary strings (e.g. "bar", "tray", "main", "settings") and the
// MCP module never hard-codes them.

import type { BrowserWindow } from "electron";

export type SurfaceMap = Record<string, BrowserWindow | null>;

export type SurfaceGetter = () => SurfaceMap;

class SurfaceNotFoundError extends Error {
  constructor(surface: string) {
    super(
      `surface "${surface}" is not available (window not created or already destroyed)`,
    );
    this.name = "SurfaceNotFoundError";
  }
}

export function resolveSurface(
  getSurfaces: SurfaceGetter,
  surface: string,
): BrowserWindow {
  const win = getSurfaces()[surface];
  if (!win || win.isDestroyed()) {
    throw new SurfaceNotFoundError(surface);
  }
  return win;
}
