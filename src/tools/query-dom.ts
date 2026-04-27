// Single `Runtime.evaluate` round-trip rather than the DOM-domain
// nodeId/objectId chain (~10x fewer calls).

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getOrAttachSession } from "../cdp";
import type { SurfaceGetter } from "../surfaces";

const inputSchema = {
  surface: z.string().min(1).describe("Which surface to query."),
  selector: z
    .string()
    .min(1)
    .describe(
      "CSS selector. Up to `limit` matches (default 50) are returned; see " +
        "`truncated` + `totalFound` in the result to detect when more exist.",
    ),
  attrs: z
    .array(z.string())
    .max(20)
    .optional()
    .describe(
      'Attribute names to include per match (max 20). Defaults to ["id", ' +
        '"class", "data-testid", "aria-label", "role", "href", "name", "type"]. ' +
        "Upper bound prevents query amplification when a caller passes a huge list.",
    ),
  limit: z
    .number()
    .int()
    .positive()
    .max(200)
    .optional()
    .describe(
      "Cap on matches returned (1–200). Defaults to 50. Bounds the " +
        "serialized response size — note that the browser still runs " +
        "`querySelectorAll` in full internally, so `limit` doesn't " +
        "prevent the query cost itself; for that use a more specific " +
        "selector than `*`. `timeoutMs` is the real runaway guard.",
    ),
  timeoutMs: z
    .number()
    .int()
    .positive()
    .max(60_000)
    .optional()
    .describe(
      "CDP Runtime.evaluate timeout in ms (1-60000). Defaults to 5000. " +
        "Guards against a runaway selector hanging the tool.",
    ),
};

const DEFAULT_ATTRS = [
  "id",
  "class",
  "data-testid",
  "aria-label",
  "role",
  "href",
  "name",
  "type",
];

interface RuntimeEvaluateResult {
  result: { type: string; value?: unknown };
  exceptionDetails?: { text: string; exception?: { description?: string } };
}

export function registerQueryDom(
  server: McpServer,
  getSurfaces: SurfaceGetter,
): void {
  server.registerTool(
    "query_dom",
    {
      title: "Query DOM",
      description:
        "Return a compact JSON array of elements matching a CSS selector — " +
        "tag, text content, selected attributes, bounding rect. Use this " +
        "before `click`/`type_text` to confirm the selector is right. " +
        "Note: `text` comes from `textContent`/`value` and is not filtered " +
        "for visibility — `display:none`/`visibility:hidden` text still " +
        "appears. The `visible` flag (computed from the bounding rect) is " +
        "the right thing to gate on if you only want on-screen matches.",
      inputSchema,
    },
    async ({
      surface,
      selector,
      attrs = DEFAULT_ATTRS,
      limit = 50,
      timeoutMs = 5000,
    }) => {
      const session = getOrAttachSession(getSurfaces, surface);

      // Report `totalFound` alongside the bounded `matches` slice so
      // the caller can distinguish "count equals limit exactly" from
      // truncation.
      const expression = `(() => {
        const nodes = Array.from(document.querySelectorAll(${JSON.stringify(selector)}));
        const totalFound = nodes.length;
        const sliced = nodes.slice(0, ${limit});
        return {
          totalFound,
          matches: sliced.map((el) => {
            const r = el.getBoundingClientRect();
            const attrObj = {};
            for (const name of ${JSON.stringify(attrs)}) {
              const v = el.getAttribute(name);
              if (v !== null) {
                // Cap per-value at 200 chars so a giant class/data-
                // attribute can't dominate the response.
                attrObj[name] = v.length > 200 ? v.slice(0, 200) + "…" : v;
              }
            }
            // Form controls expose state via .value, not textContent.
            const rawText =
              el instanceof HTMLInputElement ||
              el instanceof HTMLTextAreaElement ||
              el instanceof HTMLSelectElement
                ? el.value
                : (el.textContent ?? "");
            return {
              tag: el.tagName.toLowerCase(),
              text: String(rawText).trim().slice(0, 200),
              attrs: attrObj,
              rect: { x: r.x, y: r.y, width: r.width, height: r.height },
              visible: r.width > 0 && r.height > 0,
            };
          }),
        };
      })()`;

      const res = (await session.send("Runtime.evaluate", {
        expression,
        returnByValue: true,
        timeout: timeoutMs, // pathological-selector guard
      })) as RuntimeEvaluateResult;

      if (res.exceptionDetails) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `query_dom threw: ${res.exceptionDetails.exception?.description ?? res.exceptionDetails.text}`,
            },
          ],
        };
      }

      const payload = (res.result.value ?? { totalFound: 0, matches: [] }) as {
        totalFound: number;
        matches: unknown[];
      };
      const truncated = payload.totalFound > payload.matches.length;
      return {
        content: [
          {
            type: "text",
            text: `${payload.matches.length} match(es) for ${selector}${truncated ? ` (of ${payload.totalFound} total — truncated at limit ${limit})` : ""}\n${JSON.stringify(payload.matches, null, 2)}`,
          },
        ],
        structuredContent: {
          surface,
          selector,
          matches: payload.matches,
          totalFound: payload.totalFound,
          truncated,
        },
      };
    },
  );
}
