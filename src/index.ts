// Public entry: synchronous factory returning an explicit-lifecycle
// handle. Gating (app.isPackaged, env opt-in, port parsing) lives in
// the consumer (main.ts) — this module makes no assumptions about the
// host process.

import { Mutex } from "async-mutex";
import { type RunningMcpServer, startMcpServer } from "./server.js";
import type { SurfaceGetter, SurfaceMap } from "./surfaces.js";
import type { ToolDef } from "./tool-def.js";

export type { SurfaceGetter, SurfaceMap, ToolDef };

interface ElectronMcpServerConfig {
  getSurfaces: SurfaceGetter;
  port?: number;
  host?: string;
  // Override server identity advertised in MCP `initialize`. Defaults
  // to `{ name: "@nebula-agents/electron-mcp", version: "0.1.0" }`.
  serverInfo?: { name: string; version: string };
  // Override the `initialize.instructions` text shown to the client.
  // Defaults to a generic "drives floating BrowserWindow surfaces"
  // string baked into the package.
  instructions?: string;
}

export interface ElectronMcpServerHandle {
  // Register a consumer tool. Must be called BEFORE `start()`; throws
  // afterwards. Tools registered here are bound to every per-session
  // McpServer alongside the bundled tools.
  addTool: (tool: ToolDef) => void;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  readonly isRunning: boolean;
  // The bound URL once running, otherwise `null`. The port may be
  // kernel-assigned when `config.port === 0`, so this is the source
  // of truth (not the input config).
  readonly url: string | null;
}

export function createElectronMcpServer(
  config: ElectronMcpServerConfig,
): ElectronMcpServerHandle {
  const tools: ToolDef[] = [];
  let running: RunningMcpServer | null = null;
  // Single mutex serialises start/stop in both directions — without it
  // an interleaving like start()→stop()-while-starting-resolves leaves
  // the server up after the user thought stop() ran. Repo guideline
  // (AGENTS.md) prefers `Mutex.runExclusive` over hand-rolled latches.
  const lifecycle = new Mutex();
  // `addTool` ordering is checked synchronously and so can't read
  // `lifecycle.isLocked()` reliably (the lock state may flip between
  // a concurrent call's check and the mutator). Track "start has been
  // called at least once" with a flag; once true, addTool throws.
  let startInvoked = false;

  const handle: ElectronMcpServerHandle = {
    addTool(tool) {
      if (startInvoked) {
        throw new Error(
          `[mcp] addTool("${tool.name}") called after start() — register all tools before starting the server`,
        );
      }
      tools.push(tool);
    },
    async start() {
      startInvoked = true;
      await lifecycle.runExclusive(async () => {
        if (running !== null) return;
        running = await startMcpServer({
          getSurfaces: config.getSurfaces,
          extraTools: tools,
          port: config.port,
          host: config.host,
          serverInfo: config.serverInfo,
          instructions: config.instructions,
        });
      });
    },
    async stop() {
      await lifecycle.runExclusive(async () => {
        if (running === null) return;
        const current = running;
        running = null;
        await current.stop();
      });
    },
    get isRunning() {
      return running !== null;
    },
    get url() {
      return running?.url ?? null;
    },
  };

  return handle;
}
