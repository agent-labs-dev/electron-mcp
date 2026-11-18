# electron-mcp

`@nebula-agents/electron-mcp`: an MCP server embedded in an Electron main process. The app picks which `BrowserWindow` surfaces are reachable and registers custom tools; MCP clients drive those renderers over Chrome DevTools Protocol. TypeScript, pnpm, Biome, tsdown, vitest. Usage and API are in [README.md](README.md).

## Gate

```sh
pnpm gate           # biome check, tsc --noEmit, unit tests
pnpm gate:changed   # same, scoped to files changed against origin/main
```

CI runs `pnpm check` (the gate plus `pnpm build`). `pnpm test:electron` is the Playwright smoke test (`test/electron/smoke.spec.ts`); it needs Electron and xvfb, so leave it to CI.

## Invariants

- The server is opt-in and loopback-only by default (`127.0.0.1:9229/mcp`). Keep surface gating (`src/surfaces.ts`) intact: the app, not the client, decides what is reachable. `recommendedGuards` (`src/guards.ts`) is a helper the app calls before `start()`; the server does not call it.
- Unit tests are colocated `src/*.test.ts` and are the only files vitest picks up.
- `peerDependencies` pin Electron to the major the package is tested against (`>=41 <42`); change it only with the CI Electron smoke test.
- A user-visible change needs a changeset (`pnpm changeset`). Releases go through the Changesets workflow, never a local publish.

## Standards

- `repo-standards`: the RS-* requirements every cjber and agent-labs-dev repo meets; its `audit.py` checks this repo.
