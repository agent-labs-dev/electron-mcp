// Shared test doubles for MCP tool factories. Tools register against
// an `McpServer` instance from `@modelcontextprotocol/sdk`; rather
// than spin up the SDK in node, the factories see this minimal
// `registerTool`-only surface and the test asserts on captured args.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { BrowserWindow, WebContents } from "electron";
import { vi } from "vitest";
import { type ZodRawShape, z } from "zod";

interface RegisteredTool {
  name: string;
  config: {
    title?: string;
    description?: string;
    inputSchema?: ZodRawShape;
  };
  handler: (input: Record<string, unknown>) => Promise<unknown>;
}

interface FakeMcpServer {
  tools: Map<string, RegisteredTool>;
  registerTool: (
    name: string,
    config: RegisteredTool["config"],
    handler: RegisteredTool["handler"],
  ) => void;
  // Cast helper so call sites read clean.
  readonly asMcpServer: McpServer;
}

export function createFakeMcpServer(): FakeMcpServer {
  const tools = new Map<string, RegisteredTool>();
  const fake = {
    tools,
    registerTool: (
      name: string,
      config: RegisteredTool["config"],
      handler: RegisteredTool["handler"],
    ) => {
      tools.set(name, { name, config, handler });
    },
  };
  Object.defineProperty(fake, "asMcpServer", {
    get: () => fake as unknown as McpServer,
  });
  return fake as FakeMcpServer;
}

export function getTool(server: FakeMcpServer, name: string): RegisteredTool {
  const tool = server.tools.get(name);
  if (!tool) throw new Error(`tool "${name}" was not registered`);
  return tool;
}

// Wrap the registerTool input-schema (a `ZodRawShape`) in `z.object()`
// to drive a parse — the SDK does this internally before calling the
// handler.
export function parseInput(tool: RegisteredTool, input: unknown) {
  const shape = tool.config.inputSchema ?? {};
  return z.object(shape).safeParse(input);
}

interface FakeWebContentsOptions {
  id?: number;
  url?: string;
  isLoading?: boolean;
  isDevToolsOpened?: boolean;
  isAttached?: boolean;
  cdp?: Record<
    string,
    | unknown
    | ((
        params: Record<string, unknown> | undefined,
      ) => unknown | Promise<unknown>)
  >;
  capturePage?: (rect?: {
    x: number;
    y: number;
    width: number;
    height: number;
  }) => Promise<FakeNativeImage>;
}

interface FakeNativeImage {
  isEmpty: () => boolean;
  toPNG: () => Buffer;
  getSize: () => { width: number; height: number };
}

export function createFakeImage(opts: {
  empty?: boolean;
  png?: Buffer;
  width?: number;
  height?: number;
}): FakeNativeImage {
  const empty = opts.empty ?? false;
  const png = opts.png ?? Buffer.from([]);
  const width = opts.width ?? 0;
  const height = opts.height ?? 0;
  return {
    isEmpty: () => empty,
    toPNG: () => png,
    getSize: () => ({ width, height }),
  };
}

type Listener = (...args: unknown[]) => void;

interface FakeWebContents {
  id: number;
  debugger: {
    isAttached: () => boolean;
    attach: (version: string) => void;
    detach: () => void;
    sendCommand: (
      method: string,
      params?: Record<string, unknown>,
    ) => Promise<unknown>;
    on: (event: string, listener: Listener) => void;
    off: (event: string, listener: Listener) => void;
  };
  isLoading: () => boolean;
  isDevToolsOpened: () => boolean;
  closeDevTools: () => void;
  capturePage: FakeWebContentsOptions["capturePage"];
  reload: () => void;
  reloadIgnoringCache: () => void;
  getURL: () => string;
  on: (event: string, listener: Listener) => void;
  off: (event: string, listener: Listener) => void;
  once: (event: string, listener: Listener) => void;
  emit: (event: string, ...args: unknown[]) => void;
  cdpCalls: Array<{ method: string; params?: Record<string, unknown> }>;
  // Test-only helpers for exercising debugger event flow.
  emitDebugger: (event: string, ...args: unknown[]) => void;
  debuggerListenerCount: (event: string) => number;
  asWebContents: WebContents;
}

export function createFakeWebContents(
  opts: FakeWebContentsOptions = {},
): FakeWebContents {
  let attached = opts.isAttached ?? true;
  const listeners = new Map<string, Set<Listener>>();
  const onceListeners = new Map<string, Set<Listener>>();
  const cdpCalls: FakeWebContents["cdpCalls"] = [];

  const cdpResponses = opts.cdp ?? {};

  const on = (event: string, listener: Listener) => {
    const bucket = listeners.get(event) ?? new Set();
    bucket.add(listener);
    listeners.set(event, bucket);
  };
  const off = (event: string, listener: Listener) => {
    listeners.get(event)?.delete(listener);
    onceListeners.get(event)?.delete(listener);
  };
  const once = (event: string, listener: Listener) => {
    const bucket = onceListeners.get(event) ?? new Set();
    bucket.add(listener);
    onceListeners.set(event, bucket);
  };
  const emit = (event: string, ...args: unknown[]) => {
    for (const l of listeners.get(event) ?? []) l(...args);
    for (const l of onceListeners.get(event) ?? []) l(...args);
    onceListeners.get(event)?.clear();
  };

  // Track debugger listeners so tests can exercise the same
  // attach/detach/cleanup contract production code follows. Using
  // bare `vi.fn()` for on/off lets tools that skip getOrAttachSession
  // (or break listener teardown) silently pass tests.
  const debuggerListeners = new Map<string, Set<Listener>>();
  const debuggerOn = (event: string, listener: Listener) => {
    const bucket = debuggerListeners.get(event) ?? new Set();
    bucket.add(listener);
    debuggerListeners.set(event, bucket);
  };
  const debuggerOff = (event: string, listener: Listener) => {
    debuggerListeners.get(event)?.delete(listener);
  };
  const emitDebugger = (event: string, ...args: unknown[]) => {
    for (const l of debuggerListeners.get(event) ?? []) l(...args);
  };

  const fake = {
    id: opts.id ?? 1,
    debugger: {
      isAttached: () => attached,
      attach: vi.fn((_version: string) => {
        attached = true;
      }),
      detach: vi.fn(() => {
        attached = false;
      }),
      sendCommand: async (method: string, params?: Record<string, unknown>) => {
        // Reject post-detach calls so tests catch tools that mint a
        // stale session handle and keep using it after teardown.
        if (!attached) {
          throw new Error(
            `[fake-debugger] sendCommand("${method}") while not attached`,
          );
        }
        cdpCalls.push({ method, params });
        const response = cdpResponses[method];
        if (typeof response === "function") {
          return await (
            response as (p: Record<string, unknown> | undefined) => unknown
          )(params);
        }
        return response ?? {};
      },
      on: vi.fn(debuggerOn),
      off: vi.fn(debuggerOff),
    },
    // Test-only escape hatch — fire a debugger event the way Electron
    // does so tests can exercise CdpSession listener-cleanup paths.
    emitDebugger,
    debuggerListenerCount: (event: string) =>
      debuggerListeners.get(event)?.size ?? 0,
    isLoading: () => opts.isLoading ?? false,
    isDevToolsOpened: () => opts.isDevToolsOpened ?? false,
    closeDevTools: vi.fn(),
    capturePage: opts.capturePage,
    reload: vi.fn(),
    reloadIgnoringCache: vi.fn(),
    getURL: () => opts.url ?? "http://localhost/",
    on,
    off,
    once,
    emit,
    cdpCalls,
  };
  Object.defineProperty(fake, "asWebContents", {
    get: () => fake as unknown as WebContents,
  });
  return fake as unknown as FakeWebContents;
}

interface FakeBrowserWindowOptions {
  visible?: boolean;
  focused?: boolean;
  focusable?: boolean;
  alwaysOnTop?: boolean;
  destroyed?: boolean;
  bounds?: { x: number; y: number; width: number; height: number };
  webContents?: FakeWebContents;
}

interface FakeBrowserWindow {
  webContents: FakeWebContents;
  isDestroyed: () => boolean;
  isVisible: () => boolean;
  isFocused: () => boolean;
  isFocusable: () => boolean;
  isAlwaysOnTop: () => boolean;
  getBounds: () => { x: number; y: number; width: number; height: number };
  show: () => void;
  hide: () => void;
  focus: () => void;
  __setVisible: (next: boolean) => void;
  __setFocused: (next: boolean) => void;
  __setFocusable: (next: boolean) => void;
  __destroy: () => void;
  showCalls: number;
  hideCalls: number;
  focusCalls: number;
  asBrowserWindow: BrowserWindow;
}

export function createFakeBrowserWindow(
  opts: FakeBrowserWindowOptions = {},
): FakeBrowserWindow {
  let visible = opts.visible ?? true;
  let focused = opts.focused ?? false;
  let focusable = opts.focusable ?? true;
  let destroyed = opts.destroyed ?? false;
  const win = {
    webContents: opts.webContents ?? createFakeWebContents(),
    isDestroyed: () => destroyed,
    isVisible: () => visible,
    isFocused: () => focused,
    isFocusable: () => focusable,
    isAlwaysOnTop: () => opts.alwaysOnTop ?? false,
    getBounds: () => opts.bounds ?? { x: 0, y: 0, width: 100, height: 100 },
    show: () => {
      visible = true;
      win.showCalls += 1;
    },
    hide: () => {
      visible = false;
      win.hideCalls += 1;
    },
    focus: () => {
      focused = true;
      win.focusCalls += 1;
    },
    __setVisible: (n: boolean) => {
      visible = n;
    },
    __setFocused: (n: boolean) => {
      focused = n;
    },
    __setFocusable: (n: boolean) => {
      focusable = n;
    },
    __destroy: () => {
      destroyed = true;
    },
    showCalls: 0,
    hideCalls: 0,
    focusCalls: 0,
  };
  Object.defineProperty(win, "asBrowserWindow", {
    get: () => win as unknown as BrowserWindow,
  });
  return win as unknown as FakeBrowserWindow;
}
