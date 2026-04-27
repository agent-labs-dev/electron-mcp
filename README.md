# `@nebula-agents/electron-mcp`

Embedded MCP server for Electron apps. It runs inside your Electron main
process, exposes the `BrowserWindow` surfaces you choose, and lets MCP clients
drive those renderers through Chrome DevTools Protocol.

## Embedded vs External Attach

This package is for apps that want MCP automation as an opt-in feature of the
app itself. Your main process decides when the server starts, which windows are
reachable, and which custom tools are registered.

External-attach servers connect to an already-running Electron app through a
remote debugging port. That can be useful for local debugging, but it does not
let the app own surface naming, gating, or app-specific tools. If you want that
external model, this package is probably not the right fit.

## Quickstart

```ts
import { app, BrowserWindow } from "electron";
import { createElectronMcpServer } from "@nebula-agents/electron-mcp";

let mainWindow: BrowserWindow | null = null;

const mcp = createElectronMcpServer({
  getSurfaces: () => ({ main: mainWindow }),
});

app.whenReady().then(async () => {
  mainWindow = new BrowserWindow();

  if (recommendedGuards()) {
    await mcp.start();
    console.log(`MCP listening at ${mcp.url}`);
  }
});

app.on("before-quit", () => {
  void mcp.stop();
});

function recommendedGuards(): boolean {
  return !app.isPackaged && process.env.MY_APP_MCP === "1";
}
```

Connect an MCP client to the logged HTTP URL. The default is
`http://127.0.0.1:9229/mcp`.

## API

```ts
const mcp = createElectronMcpServer({
  getSurfaces: () => ({ main: mainWindow, settings: settingsWindow }),
  port: 9229,
  host: "127.0.0.1",
  path: "/mcp",
  instructions: "Optional client-facing instructions.",
});
```

`createElectronMcpServer(config)` returns a synchronous handle:

- `addTool(toolDef)` registers a custom tool. Call it before `start()`.
- `start()` starts the loopback HTTP server.
- `stop()` stops the HTTP server and detaches CDP sessions.
- `isRunning` reports whether the server is active.
- `url` is the bound MCP endpoint once running.

Bundled tools:

- `list_surfaces`
- `show_surface`
- `hide_surface`
- `focus_surface`
- `reload_surface`
- `screenshot`
- `evaluate`
- `click`
- `type_text`
- `press_key`
- `hover`
- `query_dom`
- `ax_snapshot`
- `fill_form`
- `wait_for_load`

Public types are available from the root export and from
`@nebula-agents/electron-mcp/types`.

## Custom Tools

```ts
import { z } from "zod";
import type { ToolDef } from "@nebula-agents/electron-mcp/types";

const resetStateTool: ToolDef = {
  name: "reset_state",
  config: {
    title: "Reset State",
    description: "Reset the app's local demo state.",
    inputSchema: { profile: z.enum(["empty", "demo"]) },
  },
  handler: async ({ profile }) => {
    await resetLocalState(profile);
    return { content: [{ type: "text", text: "ok" }] };
  },
};

mcp.addTool(resetStateTool);
```

Tools must be registered before `start()`. Dynamic tool registration and
`tools/list_changed` are intentionally out of scope for `0.x`.

## Security Model

The server binds to loopback only by default: `127.0.0.1`. Attempts to bind a
non-loopback host throw. There is no authentication layer in `0.1.0`; if your
threat model requires more than loopback isolation, wrap this package in your
own gate or do not start it.

Recommended production guard:

```ts
function recommendedGuards(): boolean {
  return !app.isPackaged && process.env.MY_APP_MCP === "1";
}
```

## Maintenance

This is open code with no support SLA. Agent Labs reviews issues and PRs on a
best-effort basis. `0.x` versions may change API shape based on real usage.

## License

MIT.
