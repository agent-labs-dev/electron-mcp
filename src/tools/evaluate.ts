// `evaluate` runs in the renderer main world. Scope caveats live in
// the tool's MCP description so the agent reads them every session.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getOrAttachSession } from "../cdp.js";
import type { SurfaceGetter } from "../surfaces.js";

const inputSchema = {
  surface: z
    .string()
    .min(1)
    .describe("Which surface's renderer to evaluate in."),
  expression: z
    .string()
    .describe(
      "JavaScript to evaluate. Must be a single expression (wrap multiple " +
        "statements in an IIFE). Runs in the renderer main world.",
    ),
  awaitPromise: z
    .boolean()
    .optional()
    .describe(
      "Await the evaluation's promise before returning. Defaults to true.",
    ),
  returnByValue: z
    .boolean()
    .optional()
    .describe(
      "Serialize the result as JSON instead of returning a remote-object " +
        "handle. Defaults to true; pass false only if you need the handle.",
    ),
  timeoutMs: z
    .number()
    .int()
    .positive()
    .max(60_000)
    .optional()
    .describe("Evaluation timeout in ms (1-60000). Defaults to 5000."),
};

interface RuntimeEvaluateResult {
  result: {
    type: string;
    subtype?: string;
    value?: unknown;
    description?: string;
    unserializableValue?: string;
  };
  exceptionDetails?: {
    exceptionId: number;
    text: string;
    lineNumber: number;
    columnNumber: number;
    exception?: { description?: string; value?: unknown };
  };
}

export function registerEvaluate(
  server: McpServer,
  getSurfaces: SurfaceGetter,
): void {
  server.registerTool(
    "evaluate",
    {
      title: "Evaluate JS in renderer",
      description:
        "Run JavaScript in the specified surface's renderer main world via " +
        "CDP Runtime.evaluate. Returns the value (JSON-serialized) or an " +
        "exception description. Main-world scope: DOM, React, Zustand, and " +
        "window.nebula are reachable; Node/Electron APIs are not.",
      inputSchema,
    },
    async ({
      surface,
      expression,
      awaitPromise = true,
      returnByValue = true,
      timeoutMs = 5000,
    }) => {
      const session = getOrAttachSession(getSurfaces, surface);
      const res = (await session.send("Runtime.evaluate", {
        expression,
        awaitPromise,
        returnByValue,
        timeout: timeoutMs,
        generatePreview: true, // string form for non-serializable
        userGesture: true, // autoplay/clipboard gates
      })) as RuntimeEvaluateResult;

      if (res.exceptionDetails) {
        const exc = res.exceptionDetails;
        const summary =
          exc.exception?.description ?? exc.text ?? "unknown exception";
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Evaluation threw at ${exc.lineNumber}:${exc.columnNumber}\n${summary}`,
            },
          ],
          structuredContent: { exception: exc },
        };
      }

      // CDP reports `NaN`, `Infinity`, `-0`, bigints, etc. via
      // `unserializableValue` rather than `value` — fall back to it
      // before the generic `description`/`type` so the agent sees the
      // actual value instead of a "number" placeholder.
      const { value, unserializableValue, description, type } = res.result;
      const text =
        value === undefined
          ? (unserializableValue ?? description ?? String(type))
          : typeof value === "string"
            ? value
            : JSON.stringify(value, null, 2);

      return {
        content: [{ type: "text", text }],
        structuredContent: { result: res.result },
      };
    },
  );
}
