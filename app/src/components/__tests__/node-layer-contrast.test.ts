import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * WCAG contrast over the node layer, computed from the real token values in
 * `base.css` rather than from a table someone kept up to date by hand.
 *
 * Floors, per the redesign plan:
 *   - node title:                   4.5:1  (body text)
 *   - rest line, metrics, glyphs:   3.0:1  (11–12px supporting text and
 *                                          non-text UI; 4.5:1 is the target)
 *   - status borders:               3.0:1  (non-text UI)
 *
 * This is what caught `--aw-text-muted` at 2.56:1 on white — fine as an input
 * placeholder, not fine for a metrics row the user is meant to read.
 */

const BASE_CSS = readFileSync(
  join("src", "styles", "base.css"),
  "utf-8",
);

/**
 * Resolve a token to its literal hex in one theme, following `var(--other)`
 * aliases — dark reuses `--aw-text-muted` for the node muted token, and a
 * resolver that only understood literals would report that as missing.
 */
function tokenValue(name: string, theme: "light" | "dark", depth = 0): string {
  if (depth > 4) throw new Error(`--${name} alias chain too deep`);

  // `:root` comes first in the file, `.dark` second.
  const darkStart = BASE_CSS.indexOf(".dark,");
  const scope =
    theme === "light"
      ? BASE_CSS.slice(0, darkStart)
      : BASE_CSS.slice(darkStart);

  const declaration = scope.match(new RegExp(`--${name}:\\s*([^;]+);`));
  // Dark inherits anything it does not redeclare.
  if (declaration?.[1] === undefined) {
    if (theme === "dark") return tokenValue(name, "light", depth + 1);
    throw new Error(`--${name} is not declared in ${theme}`);
  }

  const value = declaration[1].trim();
  const literal = value.match(/^#[0-9a-fA-F]{3,8}$/);
  if (literal) return value;

  const alias = value.match(/^var\(--([\w-]+)\)$/);
  if (alias?.[1] !== undefined) return tokenValue(alias[1], theme, depth + 1);

  throw new Error(`--${name} in ${theme} is neither a hex nor an alias: ${value}`);
}

function relativeLuminance(hex: string): number {
  const clean = hex.replace("#", "");
  const channels = [0, 2, 4].map((i) => {
    const value = parseInt(clean.substr(i, 2), 16) / 255;
    return value <= 0.03928
      ? value / 12.92
      : Math.pow((value + 0.055) / 1.055, 2.4);
  }) as [number, number, number];
  return (
    0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
  );
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort(
    (x, y) => y - x,
  ) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

interface Check {
  what: string;
  token: string;
  floor: number;
}

/** Text and glyphs drawn on the node slab. */
const FOREGROUND: Check[] = [
  { what: "node title", token: "aw-text-primary", floor: 4.5 },
  { what: "rest line operation", token: "aw-text-secondary", floor: 3 },
  { what: "rest line argument / metrics", token: "aw-node-text-muted", floor: 3 },
  { what: "running glyph + border", token: "aw-status-running", floor: 3 },
  { what: "success glyph + border", token: "aw-status-success", floor: 3 },
  { what: "error glyph + border", token: "aw-status-error", floor: 3 },
  { what: "warning glyph + border", token: "aw-status-warning", floor: 3 },
  { what: "assertion tile hue", token: "aw-status-info", floor: 3 },
  { what: "focus ring / selection", token: "aw-primary", floor: 3 },
];

describe("node layer contrast", () => {
  for (const theme of ["light", "dark"] as const) {
    const surface = () =>
      theme === "light"
        ? tokenValue("aw-surface-raised", "light")
        : tokenValue("aw-surface-raised", "dark");

    describe(theme, () => {
      for (const { what, token, floor } of FOREGROUND) {
        it(`${what} clears ${floor}:1`, () => {
          const ratio = contrast(tokenValue(token, theme), surface());
          expect(
            ratio,
            `--${token} is ${ratio.toFixed(2)}:1 on the node surface`,
          ).toBeGreaterThanOrEqual(floor);
        });
      }

      it("keeps supporting text visibly quieter than the title", () => {
        const title = contrast(tokenValue("aw-text-primary", theme), surface());
        const muted = contrast(
          tokenValue("aw-node-text-muted", theme),
          surface(),
        );
        expect(muted).toBeLessThan(title);
      });
    });
  }

  it("uses a node-scoped muted token because the chrome one fails on white", () => {
    // The regression this guards: someone "simplifies" --aw-node-text-muted
    // back to --aw-text-muted and silently drops the metrics row to 2.56:1.
    const chromeMuted = contrast(
      tokenValue("aw-text-muted", "light"),
      tokenValue("aw-surface-raised", "light"),
    );
    const nodeMuted = contrast(
      tokenValue("aw-node-text-muted", "light"),
      tokenValue("aw-surface-raised", "light"),
    );

    expect(chromeMuted).toBeLessThan(3);
    expect(nodeMuted).toBeGreaterThanOrEqual(4.5);
  });
});
