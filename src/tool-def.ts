// Public tool-definition shape for `addTool()`. Mirrors the args of
// `McpServer.registerTool` from `@modelcontextprotocol/sdk` so a
// consumer can build a tool with the SDK's types and hand it to us
// without an extra adapter layer. This is the contract that will
// extract verbatim into the future `@nebula-agents/electron-mcp/types`
// sub-export.
//
// We can't lift the SDK's generic registerTool signature with
// `Parameters<...>` (resolves to `never` for generic methods), and
// chasing the full Zod-schema generic chain through public types would
// pull half the SDK into our types. So we widen the schema fields to
// `unknown` and the handler to a plain async function — the registry
// doesn't enforce the schema↔handler-args relationship anyway, the SDK
// does that at registration time when we forward to `registerTool`.

import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";

export interface ToolDef {
  name: string;
  config: {
    title?: string;
    description?: string;
    // Either a `ZodRawShape` (record of zod schemas) or a JSON Schema
    // object — the SDK accepts both. Widened to `unknown` here.
    inputSchema?: unknown;
    outputSchema?: unknown;
    annotations?: ToolAnnotations;
    _meta?: Record<string, unknown>;
  };
  handler: (...args: unknown[]) => unknown;
}
