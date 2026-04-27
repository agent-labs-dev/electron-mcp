// Also exports `awaitNextLoad` (used by `reload_surface`). Uses
// Electron's `did-finish-load` / `did-fail-load` events rather than
// CDP `Page.loadEventFired` — no debugger-attach round-trip needed.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { WebContents } from "electron";
import { z } from "zod";
import { resolveSurface, type SurfaceGetter } from "../surfaces";

const DEFAULT_TIMEOUT_MS = 10_000;

// Filters subframe failures + ERR_ABORTED (-3) — both are
// false-positive signals (redirects, downloads, etc.).
function attachLoadListeners(
  webContents: WebContents,
  timeoutMs: number,
  started: number,
  onLoaded: (durationMs: number) => void,
  onFailed: (msg: string) => void,
): { cleanup: () => void } {
  const onLoad = (): void => {
    cleanup();
    onLoaded(performance.now() - started);
  };
  const onFail = (
    _event: Electron.Event,
    errorCode: number,
    errorDescription: string,
    _validatedURL: string,
    isMainFrame: boolean,
  ): void => {
    if (!isMainFrame || errorCode === -3) return;
    cleanup();
    onFailed(`load failed (${errorCode}): ${errorDescription}`);
  };
  const onTimeout = (): void => {
    cleanup();
    onFailed(`load did not finish within ${timeoutMs}ms`);
  };

  const timer = setTimeout(onTimeout, timeoutMs);
  const cleanup = (): void => {
    clearTimeout(timer);
    webContents.off("did-finish-load", onLoad);
    webContents.off("did-fail-load", onFail);
  };

  webContents.once("did-finish-load", onLoad);
  // `on` (not `once`): EventEmitter unregisters `once` listeners
  // before the handler runs, so the first ignored event would kill
  // the listener. `cleanup` does the explicit `off`.
  webContents.on("did-fail-load", onFail);

  return { cleanup };
}

// Listeners attach BEFORE `action` runs so we can't miss a
// synchronous event. `performance.now()` (monotonic) for duration.
export function awaitNextLoad(
  webContents: WebContents,
  action: () => void,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<{ status: "loaded"; durationMs: number }> {
  return new Promise((resolve, reject) => {
    const { cleanup } = attachLoadListeners(
      webContents,
      timeoutMs,
      performance.now(),
      (durationMs) => resolve({ status: "loaded", durationMs }),
      (msg) => reject(new Error(msg)),
    );

    try {
      action();
    } catch (err) {
      cleanup();
      reject(err);
    }
  });
}

// Listeners attach BEFORE `isLoading()` — a naive
// isLoading-then-attach has a TOCTOU race that would hang to timeout.
function waitForLoadIfActive(
  webContents: WebContents,
  timeoutMs: number,
): Promise<
  { status: "already-loaded" } | { status: "loaded"; durationMs: number }
> {
  return new Promise((resolve, reject) => {
    const { cleanup } = attachLoadListeners(
      webContents,
      timeoutMs,
      performance.now(),
      (durationMs) => resolve({ status: "loaded", durationMs }),
      (msg) => reject(new Error(msg)),
    );

    // If `onLoad` already settled (load finished between attach and
    // this check), the second resolve is a no-op.
    if (!webContents.isLoading()) {
      cleanup();
      resolve({ status: "already-loaded" });
    }
  });
}

const inputSchema = {
  surface: z.string().min(1).describe("Which surface to wait on."),
  timeoutMs: z
    .number()
    .int()
    .positive()
    .max(60_000)
    .optional()
    .describe("Max wait (1-60000 ms). Defaults to 10000."),
};

export function registerWaitForLoad(
  server: McpServer,
  getSurfaces: SurfaceGetter,
): void {
  server.registerTool(
    "wait_for_load",
    {
      title: "Wait for surface load",
      description:
        "Block until the surface's webContents finishes loading. " +
        "Short-circuits when no load is in progress — useful when " +
        "something external (link click, OAuth redirect) may have " +
        "triggered a navigation and you want to sync before inspecting.",
      inputSchema,
    },
    async ({ surface, timeoutMs = DEFAULT_TIMEOUT_MS }) => {
      const win = resolveSurface(getSurfaces, surface);
      const result = await waitForLoadIfActive(win.webContents, timeoutMs);
      return {
        content: [
          {
            type: "text",
            text:
              result.status === "already-loaded"
                ? `${surface} was already loaded (no wait needed)`
                : `${surface} finished loading in ${result.durationMs}ms`,
          },
        ],
        structuredContent: { surface, ...result },
      };
    },
  );
}
