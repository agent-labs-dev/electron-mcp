import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { type CdpSession, getOrAttachSession } from "../cdp.js";
import { waitForSelector } from "../cdp-helpers.js";
import { resolveSurface, type SurfaceGetter } from "../surfaces.js";

interface RuntimeEvaluateAssertResult {
  result: { value?: { ok: boolean; reason?: string } };
  exceptionDetails?: { text: string; exception?: { description?: string } };
}

// Throws if the evaluated expression threw OR returned `{ ok: false }`.
// CDP reports throws via `exceptionDetails` (not promise rejection),
// so a naive throw-inside-evaluate would silently swallow.
async function assertEvaluate(
  session: CdpSession,
  expression: string,
  timeoutMs: number,
): Promise<void> {
  const res = (await session.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    timeout: timeoutMs,
  })) as RuntimeEvaluateAssertResult;

  if (res.exceptionDetails) {
    throw new Error(
      `evaluate threw: ${res.exceptionDetails.exception?.description ?? res.exceptionDetails.text}`,
    );
  }
  const value = res.result.value;
  if (!value || value.ok !== true) {
    throw new Error(
      value?.reason ?? "evaluate returned non-ok without a reason",
    );
  }
}

const fieldSchema = z.object({
  selector: z.string().min(1).describe("CSS selector for the field."),
  value: z.string().describe("Value to insert."),
});

const inputSchema = {
  surface: z.string().min(1).describe("Which surface to fill the form on."),
  fields: z
    .array(fieldSchema)
    .min(1)
    .describe("Ordered list of selector → value pairs to fill in sequence."),
  clearFirst: z
    .boolean()
    .optional()
    .describe(
      "If true (default), select-all existing text in each field before " +
        "inserting the new value (replace). If false, move the caret to " +
        "the end of the existing content first so the new value cleanly " +
        "appends — without this, the post-click caret could land mid-text " +
        "and `Input.insertText` would splice in the middle.",
    ),
  timeoutMs: z
    .number()
    .int()
    .positive()
    .max(60_000)
    .optional()
    .describe(
      "Wait-for-selector timeout per field (1-60000 ms). Defaults to 5000.",
    ),
};

export function registerFillForm(
  server: McpServer,
  getSurfaces: SurfaceGetter,
): void {
  server.registerTool(
    "fill_form",
    {
      title: "Fill multiple form fields",
      description:
        "Fill a sequence of fields in one call. Per field: wait for the " +
        "selector, focus it, optionally clear existing text, then insert " +
        "the new value via CDP Input.insertText. Fails fast with the " +
        "failing field's index on any error.",
      inputSchema,
    },
    async ({ surface, fields, clearFirst = true, timeoutMs = 5000 }) => {
      // Show the window — same reasoning as in `click`.
      const win = resolveSurface(getSurfaces, surface);
      if (!win.isVisible()) win.show();

      const session = getOrAttachSession(getSurfaces, surface);
      const filled: Array<{ selector: string; ok: true }> = [];

      for (const [i, field] of fields.entries()) {
        try {
          const rect = await waitForSelector(
            session,
            field.selector,
            timeoutMs,
          );

          // Click (not .focus()) so focus-ring behavior matches a
          // real user click.
          await session.send("Input.dispatchMouseEvent", {
            type: "mousePressed",
            x: rect.centerX,
            y: rect.centerY,
            button: "left",
            clickCount: 1,
          });
          await session.send("Input.dispatchMouseEvent", {
            type: "mouseReleased",
            x: rect.centerX,
            y: rect.centerY,
            button: "left",
            clickCount: 1,
          });

          // Verify the click landed on (or inside, for wrappers) the
          // target — an intercepting overlay would otherwise route
          // the next `insertText` to the wrong field silently.
          await assertEvaluate(
            session,
            `(() => {
              const el = document.querySelector(${JSON.stringify(field.selector)});
              if (!el) return { ok: false, reason: "target element disappeared before typing" };
              const active = document.activeElement;
              const focused =
                active === el || (active instanceof Node && el.contains(active));
              return focused
                ? { ok: true }
                : { ok: false, reason: "click did not land focus on target — likely intercepted by an overlay" };
            })()`,
            timeoutMs,
          );

          if (clearFirst) {
            // select-all + insertText replace, cross-platform without
            // a Cmd+A / Ctrl+A dispatch. Falls through to a
            // Range-based select-all for contenteditable; throws on
            // an unclearable target so misuse can't fail silently.
            await assertEvaluate(
              session,
              `(() => {
                const el = document.querySelector(${JSON.stringify(field.selector)});
                if (!el) return { ok: false, reason: "target element disappeared before clearFirst" };
                const isClearable = (n) =>
                  !!n && (typeof n.select === "function" ||
                          (n instanceof HTMLElement && n.isContentEditable));
                const active = document.activeElement;
                const target =
                  isClearable(el)
                    ? el
                    : active instanceof Element && el.contains(active) && isClearable(active)
                      ? active
                      : null;
                if (!target) {
                  return { ok: false, reason: "clearFirst requires <input>, <textarea>, or [contenteditable] (matched element or focused descendant)" };
                }
                if (typeof target.select === "function") {
                  target.select();
                } else {
                  const range = document.createRange();
                  range.selectNodeContents(target);
                  const sel = getSelection();
                  sel?.removeAllRanges();
                  sel?.addRange(range);
                }
                return { ok: true };
              })()`,
              timeoutMs,
            );
          } else {
            // Append intent: collapse the caret to end so the click
            // landing mid-text doesn't splice the new value in.
            await assertEvaluate(
              session,
              `(() => {
                const el = document.querySelector(${JSON.stringify(field.selector)});
                if (!el) return { ok: false, reason: "target element disappeared before append" };
                const isTextField = (n) =>
                  n instanceof HTMLInputElement ||
                  n instanceof HTMLTextAreaElement;
                const isContentEditable = (n) =>
                  n instanceof HTMLElement && n.isContentEditable;
                const active = document.activeElement;
                const target =
                  isTextField(el) || isContentEditable(el)
                    ? el
                    : active instanceof Element &&
                        el.contains(active) &&
                        (isTextField(active) || isContentEditable(active))
                      ? active
                      : null;
                if (!target) {
                  // Non-text-bearing target: nothing to append to.
                  // insertText will dispatch to whatever has focus,
                  // which is the closest reasonable behaviour without
                  // forcing a particular caret semantic.
                  return { ok: true };
                }
                if (isTextField(target)) {
                  const end = target.value.length;
                  target.setSelectionRange(end, end);
                } else {
                  const range = document.createRange();
                  range.selectNodeContents(target);
                  range.collapse(false); // collapse to end
                  const sel = getSelection();
                  sel?.removeAllRanges();
                  sel?.addRange(range);
                }
                return { ok: true };
              })()`,
              timeoutMs,
            );
          }

          await session.send("Input.insertText", { text: field.value });
          filled.push({ selector: field.selector, ok: true });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: `fill_form failed at field ${i} (${field.selector}): ${msg}\n${filled.length} earlier field(s) filled before the failure.`,
              },
            ],
            structuredContent: {
              surface,
              failedIndex: i,
              failedSelector: field.selector,
              filledCount: filled.length,
              filled,
              error: msg,
            },
          };
        }
      }

      return {
        content: [
          {
            type: "text",
            text: `Filled ${filled.length} field(s) on ${surface}`,
          },
        ],
        structuredContent: {
          surface,
          filledCount: filled.length,
          filled,
          clearFirst,
        },
      };
    },
  );
}
