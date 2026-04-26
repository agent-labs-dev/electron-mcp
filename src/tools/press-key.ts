import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getOrAttachSession } from "../cdp.js";
import { type KeyModifier, keyToCdp, modifiersToMask } from "../cdp-helpers.js";
import type { SurfaceGetter } from "../surfaces.js";

const MODIFIER_VALUES = [
  "alt",
  "ctrl",
  "control",
  "meta",
  "cmd",
  "command",
  "shift",
] as const satisfies readonly KeyModifier[];

const inputSchema = {
  surface: z.string().min(1).describe("Which surface to press the key on."),
  key: z
    .string()
    .min(1)
    .describe(
      "Key name. Single printable characters (a-z, 0-9, symbols) or named " +
        "keys: Enter, Escape, Backspace, Tab, ArrowUp/Down/Left/Right, " +
        "Home, End, PageUp, PageDown, Delete, Space. For shifted glyphs " +
        "(`!`, `@`, `?`, …), pass the final glyph directly — `shift` in " +
        "`modifiers` is only auto-applied for ASCII letters, not for " +
        "shifted digits/punctuation, since the shifted-glyph mapping is " +
        "keyboard-layout-dependent.",
    ),
  modifiers: z
    .array(z.enum(MODIFIER_VALUES))
    .optional()
    .describe(
      "Modifier keys held while the key is pressed. Uses common aliases: " +
        "cmd/meta/command are equivalent; ctrl/control; alt; shift. See " +
        "`key` above for the shift-on-non-letters caveat.",
    ),
};

// Preserve first-seen order so the response echoes the caller's
// intent (e.g. `["shift", "cmd"]` stays in that order).
function normalizeModifiers(modifiers: readonly KeyModifier[]): KeyModifier[] {
  const canon: Record<KeyModifier, KeyModifier> = {
    alt: "alt",
    ctrl: "ctrl",
    control: "ctrl",
    meta: "cmd",
    cmd: "cmd",
    command: "cmd",
    shift: "shift",
  };
  const seen = new Set<KeyModifier>();
  const out: KeyModifier[] = [];
  for (const m of modifiers) {
    const c = canon[m];
    if (!seen.has(c)) {
      seen.add(c);
      out.push(c);
    }
  }
  return out;
}

export function registerPressKey(
  server: McpServer,
  getSurfaces: SurfaceGetter,
): void {
  server.registerTool(
    "press_key",
    {
      title: "Press key",
      description:
        "Dispatch a keyboard key (with optional modifiers) to the focused " +
        "renderer element. Use for named keys like Enter/Escape/arrows or " +
        "combos like Cmd+Enter. For text entry use `type_text`.",
      inputSchema,
    },
    async ({ surface, key, modifiers = [] }) => {
      const session = getOrAttachSession(getSurfaces, surface);
      const normalizedModifiers = normalizeModifiers(modifiers);
      const cdpKey = keyToCdp(key, normalizedModifiers);
      const mask = modifiersToMask(normalizedModifiers);

      // keyDown carries `text`; keyUp doesn't.
      await session.send("Input.dispatchKeyEvent", {
        type: "keyDown",
        modifiers: mask,
        ...cdpKey,
      });
      await session.send("Input.dispatchKeyEvent", {
        type: "keyUp",
        modifiers: mask,
        key: cdpKey.key,
        code: cdpKey.code,
        windowsVirtualKeyCode: cdpKey.windowsVirtualKeyCode,
      });

      return {
        content: [
          {
            type: "text",
            text: `Pressed ${normalizedModifiers.length ? `${normalizedModifiers.join("+")}+` : ""}${key} on ${surface}`,
          },
        ],
        structuredContent: { surface, key, modifiers: normalizedModifiers },
      };
    },
  );
}
