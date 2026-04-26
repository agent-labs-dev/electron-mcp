// CDP via `webContents.debugger` — per-surface isolation, no always-
// open loopback port in packaged builds, no Playwright dep. One
// session cached per surface; `detachAll()` runs at will-quit.
//
// DevTools collision: `debugger.attach()` fails if DevTools are
// already open, so we close them first (set NEBULA_OPEN_DEVTOOLS=0
// for MCP-driven tests to skip the flicker).

import type { BrowserWindow, WebContents } from "electron";
import { resolveSurface, type SurfaceGetter } from "./surfaces.js";

const CDP_PROTOCOL_VERSION = "1.3";

// Narrow union for autocomplete; unknown methods still pass via `string`.
type CdpMethod =
  | "Runtime.enable"
  | "Runtime.evaluate"
  | "Page.enable"
  | "Page.captureScreenshot"
  | "DOM.enable"
  | "DOM.getDocument"
  | string;

export interface CdpSession {
  surface: string;
  webContents: WebContents;
  // Callers narrow the `unknown` response with `as <local-interface>`.
  send: (
    method: CdpMethod,
    params?: Record<string, unknown>,
  ) => Promise<unknown>;
  detach: () => void;
}

interface AttachedRecord {
  surface: string;
  win: BrowserWindow;
  teardownListener: () => void;
}

const attached = new Map<string, AttachedRecord>();

export function getOrAttachSession(
  getSurfaces: SurfaceGetter,
  surface: string,
): CdpSession {
  const win = resolveSurface(getSurfaces, surface);
  const wc = win.webContents;

  const existing = attached.get(surface);
  if (existing && !existing.win.isDestroyed() && wc.debugger.isAttached()) {
    return buildSession(existing.surface, wc);
  }

  // Close auto-opened DevTools to avoid the attach conflict.
  if (wc.isDevToolsOpened()) {
    console.warn(
      `[mcp] closing DevTools on "${surface}" surface so the CDP debugger can attach. ` +
        `Set NEBULA_OPEN_DEVTOOLS=0 when running MCP-driven tests to skip the flicker.`,
    );
    wc.closeDevTools();
  }

  try {
    wc.debugger.attach(CDP_PROTOCOL_VERSION);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `[mcp] debugger.attach failed for surface "${surface}": ${msg}`,
    );
  }

  // Drop the cache on external detach (developer DevTools, another
  // debugger, renderer crash) so the next call re-attaches cleanly.
  const onDetach = (_event: Electron.Event, reason: string) => {
    console.warn(
      `[mcp] debugger detached from "${surface}" (reason: ${reason})`,
    );
    attached.delete(surface);
  };
  wc.debugger.on("detach", onDetach);

  const record: AttachedRecord = {
    surface,
    win,
    teardownListener: () => wc.debugger.off("detach", onDetach),
  };
  attached.set(surface, record);

  return buildSession(surface, wc);
}

function buildSession(surface: string, wc: WebContents): CdpSession {
  return {
    surface,
    webContents: wc,
    send: async (method, params) => {
      return wc.debugger.sendCommand(method, params ?? {});
    },
    detach: () => {
      const rec = attached.get(surface);
      if (rec) rec.teardownListener();
      attached.delete(surface);
      if (wc.debugger.isAttached()) {
        try {
          wc.debugger.detach();
        } catch {
          // Already detached — ignore.
        }
      }
    },
  };
}

export function detachAll(): void {
  for (const [, rec] of attached) {
    try {
      rec.teardownListener();
      if (!rec.win.isDestroyed() && rec.win.webContents.debugger.isAttached()) {
        rec.win.webContents.debugger.detach();
      }
    } catch {
      // Best-effort cleanup.
    }
  }
  attached.clear();
}
