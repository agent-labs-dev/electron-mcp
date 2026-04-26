// AX-tree snapshot via `Accessibility.getFullAXTree` — high-signal,
// low-token UI description. The optional `root` selector prunes to
// a subtree to stay under the 10k-token output soft-limit.

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getOrAttachSession } from "../cdp.js";
import type { SurfaceGetter } from "../surfaces.js";

const inputSchema = {
  surface: z.string().min(1).describe("Which surface to snapshot."),
  root: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Optional CSS selector to scope the snapshot. Omit for the whole " +
        "surface tree. Empty strings are rejected at validation time so " +
        "they can't silently fall through to the full-tree path.",
    ),
  interestingOnly: z
    .boolean()
    .optional()
    .describe(
      "Drop uninteresting nodes (role=none, ignored wrappers, etc.) from " +
        "the returned snapshot. Filtering happens locally on the JSON we " +
        "ship back, not via CDP — `Accessibility.getFullAXTree` doesn't " +
        "expose a server-side prune flag in our stable channel. Defaults " +
        "to true — large savings, same information.",
    ),
};

interface AxNode {
  nodeId: string;
  role?: { value: string };
  name?: { value: string };
  value?: { value?: unknown };
  properties?: Array<{ name: string; value: { value: unknown } }>;
  childIds?: string[];
  backendDOMNodeId?: number;
  ignored?: boolean;
}

interface GetFullAxTreeResponse {
  nodes: AxNode[];
}

// RemoteObject lives at `.result`, not `.object`.
interface RuntimeEvaluateObjectResponse {
  result: { objectId?: string; subtype?: string; type: string };
  exceptionDetails?: { text: string; exception?: { description?: string } };
}

interface RequestNodeResponse {
  nodeId: number;
}

interface GetPartialAxTreeResponse {
  nodes: AxNode[];
}

const ROOT_EVAL_TIMEOUT_MS = 5000;

export function registerAxSnapshot(
  server: McpServer,
  getSurfaces: SurfaceGetter,
): void {
  server.registerTool(
    "get_ax_snapshot",
    {
      title: "Accessibility-tree snapshot",
      description:
        "Capture the accessibility tree of a surface. Role + name + state " +
        "for each node — much more compact than full DOM for describing " +
        "UI to an LLM. Use before `click`/`type_text` to see what's " +
        "actually on screen.",
      inputSchema,
    },
    async ({ surface, root, interestingOnly = true }) => {
      const session = getOrAttachSession(getSurfaces, surface);
      // Re-enable each call; pair with `disable` in `finally` —
      // leaving AX on has ongoing page-perf cost.
      await session.send("Accessibility.enable");
      try {
        if (root) {
          // Resolve via Runtime.evaluate → DOM.requestNode →
          // Accessibility.getPartialAXTree.
          const evalRes = (await session.send("Runtime.evaluate", {
            expression: `document.querySelector(${JSON.stringify(root)})`,
            timeout: ROOT_EVAL_TIMEOUT_MS,
          })) as RuntimeEvaluateObjectResponse;
          if (evalRes.exceptionDetails || !evalRes.result.objectId) {
            const reason =
              evalRes.exceptionDetails?.exception?.description ??
              evalRes.exceptionDetails?.text ??
              "selector returned null";
            return {
              isError: true,
              content: [
                {
                  type: "text",
                  text: `root selector not resolvable: ${root} (${reason})`,
                },
              ],
            };
          }
          // Release the evaluate handle in `finally` so we don't
          // accumulate stale objectIds across snapshots.
          const objectId = evalRes.result.objectId;
          try {
            const reqRes = (await session.send("DOM.requestNode", {
              objectId,
            })) as RequestNodeResponse;
            const partial = (await session.send(
              "Accessibility.getPartialAXTree",
              { nodeId: reqRes.nodeId, fetchRelatives: true },
            )) as GetPartialAxTreeResponse;
            return formatTree(surface, partial.nodes, {
              interestingOnly,
              root,
            });
          } finally {
            // Best-effort cleanup — don't shadow the real result.
            void session
              .send("Runtime.releaseObject", { objectId })
              .catch(() => {});
          }
        }

        const full = (await session.send(
          "Accessibility.getFullAXTree",
          {},
        )) as GetFullAxTreeResponse;
        return formatTree(surface, full.nodes, { interestingOnly });
      } finally {
        void session.send("Accessibility.disable").catch(() => {});
      }
    },
  );
}

function formatTree(
  surface: string,
  nodes: AxNode[],
  opts: { interestingOnly: boolean; root?: string },
) {
  const filtered = opts.interestingOnly
    ? nodes.filter((n) => !n.ignored && n.role?.value !== "none")
    : nodes;

  // Drop childIds pointing at filtered-out nodes so the tree stays
  // internally consistent for traversals.
  const keptIds = new Set(filtered.map((n) => n.nodeId));

  const simplified = filtered.map((n) => {
    const props: Record<string, unknown> = {};
    for (const p of n.properties ?? []) {
      props[p.name] = p.value.value;
    }
    return {
      id: n.nodeId,
      role: n.role?.value ?? null,
      name: n.name?.value ?? null,
      value: n.value?.value ?? null,
      properties: props,
      children: (n.childIds ?? []).filter((id) => keptIds.has(id)),
    };
  });

  return {
    content: [
      {
        type: "text" as const,
        text: `AX snapshot (${simplified.length} nodes${opts.root ? `, scoped to ${opts.root}` : ""}):\n${JSON.stringify(simplified, null, 2)}`,
      },
    ],
    structuredContent: { surface, root: opts.root ?? null, nodes: simplified },
  };
}
