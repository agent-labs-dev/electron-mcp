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
  // Guard against inherited keys (`__proto__`, `toString`, …) — a
  // plain `surfaces[surface]` lookup would return `Object.prototype`
  // for `"__proto__"`, which is not a `BrowserWindow` and would throw
  // a confusing `isDestroyed is not a function` instead of the
  // intended `SurfaceNotFoundError`.
  const surfaces = getSurfaces();
  const win = Object.prototype.hasOwnProperty.call(surfaces, surface)
    ? surfaces[surface]
    : null;
  if (!win || win.isDestroyed()) {
    throw new SurfaceNotFoundError(surface);
  }
  return win;
}
