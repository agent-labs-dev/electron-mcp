import { app, BrowserWindow } from "electron";
import { createElectronMcpServer } from "../../../dist/index.mjs";

let mainWindow = null;
let mcp = null;

app.whenReady().then(async () => {
  mainWindow = new BrowserWindow({
    width: 640,
    height: 420,
    show: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  await mainWindow.loadURL(
    `data:text/html,${encodeURIComponent(`
      <!doctype html>
      <html>
        <head><title>electron-mcp smoke</title></head>
        <body>
          <main>
            <h1 id="title">Electron MCP Smoke</h1>
            <button id="target">Click me</button>
            <script>
              window.clicked = 0;
              document.getElementById("target").addEventListener("click", () => {
                window.clicked += 1;
              });
            </script>
          </main>
        </body>
      </html>
    `)}`,
  );

  mcp = createElectronMcpServer({
    getSurfaces: () => ({ main: mainWindow }),
    port: 0,
  });
  await mcp.start();
  globalThis.__electronMcpSmokeUrl = mcp.url;
});

app.on("before-quit", () => {
  void mcp?.stop();
});
