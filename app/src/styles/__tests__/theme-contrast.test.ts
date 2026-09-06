import { describe, it, expect } from "vitest";
import { contrast, isDeclared, tokenColor } from "./themeTokens";

/**
 * WCAG contrast for every text role against every surface, in both themes.
 *
 * This is the test that makes the palette tunable. The neutral roles are now
 * alphas of one tint, so "raise muted a little" is a one-character edit that
 * moves every muted pair in both themes at once — which is only safe if
 * something recomputes them. The node layer has its own, tighter floors in
 * `components/__tests__/node-layer-contrast.test.ts`.
 *
 * Floors, per DESIGN.md §2:
 *   - primary and secondary text: 4.5:1. Both carry content.
 *   - muted text:                 3.0:1. Placeholders, hints, disabled copy —
 *                                 never content (the node layer uses
 *                                 --aw-node-text-muted for that).
 *   - accent and status:          3.0:1. Non-text UI and short labels.
 */

const SURFACES = [
  { what: "page", token: "aw-surface" },
  { what: "raised", token: "aw-surface-raised" },
  { what: "overlay", token: "aw-surface-overlay" },
] as const;

const FOREGROUNDS = [
  { what: "primary text", token: "aw-text-primary", floor: 4.5 },
  { what: "secondary text", token: "aw-text-secondary", floor: 4.5 },
  { what: "muted text", token: "aw-text-muted", floor: 3 },
  { what: "accent", token: "aw-primary", floor: 3 },
  { what: "success", token: "aw-status-success", floor: 3 },
  { what: "error", token: "aw-status-error", floor: 3 },
  { what: "warning", token: "aw-status-warning", floor: 3 },
  { what: "running", token: "aw-status-running", floor: 3 },
  { what: "info", token: "aw-status-info", floor: 3 },
] as const;

describe("theme contrast", () => {
  for (const theme of ["light", "dark"] as const) {
    describe(theme, () => {
      for (const surface of SURFACES) {
        for (const fg of FOREGROUNDS) {
          it(`${fg.what} on ${surface.what} clears ${fg.floor}:1`, () => {
            const ratio = contrast(
              tokenColor(fg.token, theme),
              tokenColor(surface.token, theme),
            );
            expect(
              ratio,
              `--${fg.token} on --${surface.token} is ${ratio.toFixed(2)}:1`,
            ).toBeGreaterThanOrEqual(fg.floor);
          });
        }
      }
    });
  }

  it("flips the tint, not a twin per neutral role", () => {
    // The regression this guards: someone re-adds `--aw-text-muted: #71717a`
    // to the dark block, and from then on every alpha change silently applies
    // to one theme only.
    for (const role of ["aw-text-secondary", "aw-text-muted", "aw-border"]) {
      expect(isDeclared(role, "dark"), `--${role} is redeclared in dark`).toBe(
        false,
      );
    }
    expect(isDeclared("aw-tint-rgb", "dark")).toBe(true);
  });

  it("keeps the hairline and the hover fill apart in dark", () => {
    // They were both #27272a under the paired palettes, so any hover fill
    // drawn next to a border showed a seam.
    const border = tokenColor("aw-border", "dark");
    const overlay = tokenColor("aw-surface-overlay", "dark");
    expect(border.a).toBeLessThan(1);
    expect(overlay.a).toBe(1);
  });
});
