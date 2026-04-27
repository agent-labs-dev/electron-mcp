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
  // Own-property guard — without it, lookups like `"__proto__"` or
  // `"constructor"` walk up Object's prototype chain and `isDestroyed()`
  // throws a raw TypeError on a function value instead of surfacing
  // the expected SurfaceNotFoundError.
  const surfaces = getSurfaces();
  const win = Object.prototype.hasOwnProperty.call(surfaces, surface)
    ? surfaces[surface]
    : null;
  if (!win || win.isDestroyed()) {
    throw new SurfaceNotFoundError(surface);
  }
  return win;
}
