import { defineConfig } from "@playwright/test";

// `_electron.launch()` is exposed via `playwright` (not `@playwright/test`'s
// browser pool). We only need the runner here — there's no browser fixture
// to configure. Workers stay at 1 because each test spawns a real Electron
// process and contends for the loopback port range.
export default defineConfig({
  testDir: "./tests",
  testMatch: /.*\.electron\.test\.ts$/,
  workers: 1,
  fullyParallel: false,
  reporter: process.env.CI ? "github" : "list",
  // Smoke test launches Electron, attaches debugger, opens an MCP HTTP
  // session — give it room on cold starts (CI-cached node_modules first
  // run can take 10s+ just on Electron unpack).
  timeout: 60_000,
});
