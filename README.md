# `@nebula-agents/electron-mcp`

> Embedded MCP (Model Context Protocol) server for Electron apps — drive your renderers via Chrome DevTools Protocol.

**Status:** 🚧 Pre-release. The implementation lives in [`agent-labs-dev/nebula-desktop`](https://github.com/agent-labs-dev/nebula-desktop) and is being extracted here. See [PRD #149](https://github.com/agent-labs-dev/nebula-desktop/issues/149) for the migration plan.

## What this is

A library for Electron app developers who want **first-class MCP integration as an opt-in feature of their own app**. Unlike external-attach approaches (which speak to Electron over its remote debugging port), this package runs the MCP server _inside_ your main process, giving you:

- Full control over which surfaces (windows) are exposed
- Custom tool registration via `addTool()` — expose your app's domain commands alongside the bundled Electron primitives (screenshot, click, type, eval, DOM/AX queries, …)
- Explicit `start()` / `stop()` lifecycle so you decide when the server runs

## Planned API

```ts
import { createElectronMcpServer } from '@nebula-agents/electron-mcp';

const mcp = createElectronMcpServer({
  getSurfaces: () => ({ main: mainWindow, settings: settingsWindow }),
});

mcp.addTool(myCustomTool);

if (!app.isPackaged && process.env.MY_APP_MCP === '1') {
  await mcp.start();
}
```

## License

MIT — see [`LICENSE`](./LICENSE).
