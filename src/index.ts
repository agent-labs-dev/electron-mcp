import { Mutex } from "async-mutex";
import {
  type McpLogger,
  type RunningMcpServer,
  startMcpServer,
} from "./server";
import type { SurfaceGetter, SurfaceMap } from "./surfaces";
import type { ToolDef } from "./tool-def";

export interface ElectronMcpServerConfig {
  getSurfaces: SurfaceGetter;
  port?: number;
  host?: string;
  path?: string;
  serverName?: string;
  serverVersion?: string;
  instructions?: string;
  logger?: Partial<McpLogger>;
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
          path: config.path,
          serverName: config.serverName,
          serverVersion: config.serverVersion,
          instructions: config.instructions,
          logger: config.logger,
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

export type { McpLogger, SurfaceGetter, SurfaceMap, ToolDef };
