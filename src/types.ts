// Public types sub-export — `@nebula-agents/electron-mcp/types`.
//
// Consumers that build `ToolDef`s in a separate package (or want to
// strongly type the surface map their app exposes) can import from this
// path without pulling in the runtime entry. Kept to *types only* so
// the import is zero-cost at bundle time.

export type { ElectronMcpServerHandle } from "./index.js";
export type { SurfaceGetter, SurfaceMap } from "./surfaces.js";
export type { ToolDef } from "./tool-def.js";
