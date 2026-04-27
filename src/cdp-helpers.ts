// Small CDP helpers shared by the input/DOM tool modules. ~100 LOC
// of selector wait + keyboard mapping rather than a Playwright dep.

import type { CdpSession } from "./cdp";

// Coordinates in CSS pixels — what `Input.dispatchMouseEvent` expects.
interface ElementRect {
  x: number;
  y: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
}

interface RuntimeEvaluateResult {
  result: {
    type: string;
    value?: unknown;
  };
  exceptionDetails?: { text: string; exception?: { description?: string } };
}

// Zero-size elements are treated as not-present so `click` doesn't
// dispatch at (0,0) on a mid-mount React element.
export async function waitForSelector(
  session: CdpSession,
  selector: string,
  timeoutMs: number,
): Promise<ElementRect> {
  const expression = `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return null;
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  })()`;

  // `performance.now()` (monotonic) so NTP/DST jumps don't skew us.
  const start = performance.now();
  while (performance.now() - start < timeoutMs) {
    // Per-evaluate timeout — without it, a hung evaluate would
    // outlive the outer `timeoutMs` gate.
    const remainingMs = timeoutMs - (performance.now() - start);
    const evalTimeoutMs = Math.max(1, Math.min(remainingMs, 1000));
    const res = (await session.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      timeout: evalTimeoutMs,
    })) as RuntimeEvaluateResult;

    if (res.exceptionDetails) {
      // Parse errors etc. — propagate immediately rather than spin.
      throw new Error(
        `selector evaluation threw: ${res.exceptionDetails.exception?.description ?? res.exceptionDetails.text}`,
      );
    }

    const v = res.result.value as {
      x: number;
      y: number;
      width: number;
      height: number;
    } | null;
    if (v) {
      return {
        x: v.x,
        y: v.y,
        width: v.width,
        height: v.height,
        centerX: v.x + v.width / 2,
        centerY: v.y + v.height / 2,
      };
    }

    await new Promise((r) => setTimeout(r, 50));
  }

  throw new Error(
    `selector did not resolve to a visible element within ${timeoutMs}ms: ${selector}`,
  );
}

// CDP modifier bitmask: alt=1, ctrl=2, meta/cmd=4, shift=8.
const MODIFIER_BITS = {
  alt: 1,
  ctrl: 2,
  control: 2,
  meta: 4,
  cmd: 4,
  command: 4,
  shift: 8,
} as const;

export type KeyModifier = keyof typeof MODIFIER_BITS;

export function modifiersToMask(modifiers: readonly KeyModifier[]): number {
  return modifiers.reduce((mask, mod) => mask | MODIFIER_BITS[mod], 0);
}

// v1 covers single printable ASCII + the named keys we actually
// use; anything else throws — extending the tables is cheap.
interface CdpKeyEvent {
  key: string;
  code: string;
  windowsVirtualKeyCode?: number;
  // Set for printable keys so `keyDown` inserts the char.
  text?: string;
}

export function keyToCdp(
  keyName: string,
  modifiers: readonly KeyModifier[] = [],
): CdpKeyEvent {
  // Shallow-copy so callers can't mutate the shared NAMED_KEYS row.
  const named = NAMED_KEYS[keyName];
  if (named) return { ...named };

  if (keyName.length === 1) {
    const shifted = modifiers.includes("shift");
    const base = keyName;
    const isLetter = /^[A-Za-z]$/.test(base);
    const isDigit = /^[0-9]$/.test(base);

    // Apply shift to letters; layouts disagree on shifted punctuation
    // so callers pass the shifted glyph directly through CHAR_CODES.
    const ch = isLetter && shifted ? base.toUpperCase() : base;
    const upper = ch.toUpperCase();

    let code: string;
    if (isLetter) {
      code = `Key${upper}`;
    } else if (isDigit) {
      code = `Digit${ch}`;
    } else {
      const mapped = CHAR_CODES[ch];
      if (!mapped) {
        // Fail loud — an empty `code` breaks handlers that key off it.
        throw new Error(
          `unsupported key "${keyName}" — add it to CHAR_CODES or NAMED_KEYS in cdp-helpers.ts`,
        );
      }
      code = mapped;
    }

    return {
      key: ch,
      code,
      windowsVirtualKeyCode:
        isLetter || isDigit ? upper.charCodeAt(0) : undefined,
      text: ch,
    };
  }

  throw new Error(
    `unsupported key "${keyName}" — add it to NAMED_KEYS in cdp-helpers.ts`,
  );
}

const NAMED_KEYS: Record<string, CdpKeyEvent> = {
  Enter: { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" },
  Escape: { key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 },
  Backspace: { key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 },
  Tab: { key: "Tab", code: "Tab", windowsVirtualKeyCode: 9, text: "\t" },
  ArrowUp: { key: "ArrowUp", code: "ArrowUp", windowsVirtualKeyCode: 38 },
  ArrowDown: { key: "ArrowDown", code: "ArrowDown", windowsVirtualKeyCode: 40 },
  ArrowLeft: { key: "ArrowLeft", code: "ArrowLeft", windowsVirtualKeyCode: 37 },
  ArrowRight: {
    key: "ArrowRight",
    code: "ArrowRight",
    windowsVirtualKeyCode: 39,
  },
  Home: { key: "Home", code: "Home", windowsVirtualKeyCode: 36 },
  End: { key: "End", code: "End", windowsVirtualKeyCode: 35 },
  PageUp: { key: "PageUp", code: "PageUp", windowsVirtualKeyCode: 33 },
  PageDown: { key: "PageDown", code: "PageDown", windowsVirtualKeyCode: 34 },
  Delete: { key: "Delete", code: "Delete", windowsVirtualKeyCode: 46 },
  " ": { key: " ", code: "Space", windowsVirtualKeyCode: 32, text: " " },
  Space: { key: " ", code: "Space", windowsVirtualKeyCode: 32, text: " " },
};

// US layout: unshifted punctuation + shifted-digit row + common
// shifted symbols. For text entry prefer `type_text` which sidesteps
// physical-key mapping.
const CHAR_CODES: Record<string, string> = {
  // Unshifted punctuation
  ".": "Period",
  ",": "Comma",
  ";": "Semicolon",
  "'": "Quote",
  "/": "Slash",
  "\\": "Backslash",
  "-": "Minus",
  "=": "Equal",
  "[": "BracketLeft",
  "]": "BracketRight",
  "`": "Backquote",
  // Shifted digit row (US layout)
  "!": "Digit1",
  "@": "Digit2",
  "#": "Digit3",
  $: "Digit4",
  "%": "Digit5",
  "^": "Digit6",
  "&": "Digit7",
  "*": "Digit8",
  "(": "Digit9",
  ")": "Digit0",
  // Shifted punctuation (US layout)
  "<": "Comma",
  ">": "Period",
  "?": "Slash",
  ":": "Semicolon",
  '"': "Quote",
  "|": "Backslash",
  _: "Minus",
  "+": "Equal",
  "{": "BracketLeft",
  "}": "BracketRight",
  "~": "Backquote",
};
