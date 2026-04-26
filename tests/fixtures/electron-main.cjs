// Minimal Electron main process for the smoke test.
//
// Boots a hidden BrowserWindow that loads a tiny inline HTML page, then
// starts an embedded `electron-mcp` server bound to an ephemeral port.
// Prints `MCP_URL=<url>` on a fresh line so the Playwright-side test can
// parse the kernel-assigned URL out of stdout.
//
// Why CommonJS: passing a `.mjs` entry to Electron 41 doesn't enter
// main-process mode (`process.type` is undefined and `require("electron")`
// returns the binary path string instead of the runtime APIs). Sticking
// to CJS for the entry; we still pull in the ESM-only `dist/index.js`
// via dynamic `import()`.
//
// The fixture imports the *built* package output (../../dist/index.js).
// `pnpm test:smoke` runs `pnpm build` first so dist is fresh.

const { app, BrowserWindow } = require("electron");
const path = require("node:path");

// Minimal renderer payload — enough for `screenshot` to capture a
// non-empty image and for `evaluate` to have a real `document`.
const PAGE_HTML = `
<!doctype html>
<html>
<head><meta charset="utf-8"><title>electron-mcp smoke fixture</title></head>
<body style="margin:0;background:#1e9bff;color:#fff;font-family:system-ui">
  <main style="padding:24px"><h1>electron-mcp smoke fixture</h1></main>
</body>
</html>
`;

async function main() {
  await app.whenReady();

  const win = new BrowserWindow({
    width: 320,
    height: 240,
    show: false,
    webPreferences: {
      // Smoke test only — disable nodeIntegration so `evaluate`'s
      // "main world doesn't see Node" guarantee holds.
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // `did-finish-load` is the cleanest signal for `screenshot` to
  // capture something non-empty; `loadURL("data:…")` resolves before
  // first paint on some platforms.
  const loaded = new Promise((resolve) => {
    win.webContents.once("did-finish-load", resolve);
  });
  await win.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(PAGE_HTML)}`,
  );
  await loaded;
  // Give the compositor a tick to actually paint pixels — capturePage
  // returns an empty image if called before the first frame lands.
  await new Promise((r) => setTimeout(r, 100));

  // dist/index.js is ESM, so dynamic-import from CJS.
  const distEntry = path.resolve(__dirname, "..", "..", "dist", "index.js");
  const { createElectronMcpServer } = await import(distEntry);

  const server = createElectronMcpServer({
    getSurfaces: () => ({ main: win }),
    // Ephemeral port — the test reads the bound URL from stdout.
    port: 0,
    serverInfo: { name: "electron-mcp-smoke-fixture", version: "0.0.0" },
  });
  await server.start();
  if (!server.url) throw new Error("server.url was null after start()");

  // Newline-bounded so the test's regex doesn't snag on a partial line.
  process.stdout.write(`MCP_URL=${server.url}\n`);

  app.on("window-all-closed", () => {
    server.stop().finally(() => app.quit());
  });
}

main().catch((err) => {
  console.error("[fixture] startup failed:", err);
  process.exit(1);
});
