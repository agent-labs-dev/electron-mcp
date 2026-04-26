import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getOrAttachSession } from "../cdp.js";
import { waitForSelector } from "../cdp-helpers.js";
import type { SurfaceGetter } from "../surfaces.js";

const inputSchema = {
  surface: z.string().min(1).describe("Which surface to type into."),
  text: z.string().describe("Text to insert at the current caret position."),
  selector: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Optional: focus this element before inserting. If omitted, text " +
        "goes to whichever element currently has focus. Empty string is " +
        'rejected at schema time — pass undefined, not "".',
    ),
  timeoutMs: z
    .number()
    .int()
    .positive()
    .max(60_000)
    .optional()
    .describe("Wait-for-selector timeout in ms (1-60000). Defaults to 5000."),
};

export function registerTypeText(
  server: McpServer,
  getSurfaces: SurfaceGetter,
): void {
  server.registerTool(
    "type_text",
    {
      title: "Type text into input",
      description:
        "Insert text at the caret. If a selector is given, focus that " +
        "element first. Uses CDP Input.insertText so React controlled " +
        "inputs receive `input` events. Use press_key for single keys " +
        "that trigger keyDown handlers (Enter, Escape, arrows, etc.).",
      inputSchema,
    },
    async ({ surface, text, selector, timeoutMs = 5000 }) => {
      const session = getOrAttachSession(getSurfaces, surface);

      if (selector) {
        await waitForSelector(session, selector, timeoutMs);

        // Verify activeElement after focus — a disabled input or
        // non-HTMLElement match would otherwise silently eat the
        // focus and `insertText` would hit the wrong field.
        const focusRes = (await session.send("Runtime.evaluate", {
          expression: `(() => {
            const el = document.querySelector(${JSON.stringify(selector)});
            if (!el || !(el instanceof HTMLElement)) return false;
            el.focus();
            return document.activeElement === el;
          })()`,
          returnByValue: true,
          timeout: timeoutMs,
        })) as {
          result?: { value?: boolean };
          exceptionDetails?: {
            text: string;
            exception?: { description?: string };
          };
        };

        if (focusRes.exceptionDetails) {
          const exc = focusRes.exceptionDetails;
          throw new Error(
            `type_text focus evaluation threw: ${exc.exception?.description ?? exc.text}`,
          );
        }
        if (focusRes.result?.value !== true) {
          throw new Error(
            `type_text could not focus selector "${selector}" — element not an HTMLElement, disabled, or stole focus elsewhere`,
          );
        }
      }

      await session.send("Input.insertText", { text });

      return {
        content: [
          {
            type: "text",
            text: selector
              ? `Typed ${text.length} char(s) into ${selector} on ${surface}`
              : `Typed ${text.length} char(s) into focused element on ${surface}`,
          },
        ],
        structuredContent: { surface, selector, charsTyped: text.length },
      };
    },
  );
}
