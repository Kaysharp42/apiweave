import { describe, it, expect } from "vitest";
import { contrast, tokenColor } from "../../styles/__tests__/themeTokens";

/**
 * WCAG contrast over the node layer, computed from the real token values in
 * `base.css` rather than from a table someone kept up to date by hand.
 * The resolver and the colour maths live in `styles/__tests__/themeTokens.ts`,
 * shared with the whole-theme sweep in `theme-contrast.test.ts`.
 *
 * Floors, per the redesign plan:
 *   - node title:                   4.5:1  (body text)
 *   - rest line, metrics, glyphs:   3.0:1  (11–12px supporting text and
 *                                          non-text UI; 4.5:1 is the target)
 *   - status borders:               3.0:1  (non-text UI)
 *
 * This is what caught `--aw-text-muted` as too quiet for a metrics row the
 * user is meant to read — fine as an input placeholder, not fine as content.
 */

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
    /** A node slab is a raised surface in both themes. */
    const surface = () => tokenColor("aw-surface-raised", theme);

    describe(theme, () => {
      for (const { what, token, floor } of FOREGROUND) {
        it(`${what} clears ${floor}:1`, () => {
          const ratio = contrast(tokenColor(token, theme), surface());
          expect(
            ratio,
            `--${token} is ${ratio.toFixed(2)}:1 on the node surface`,
          ).toBeGreaterThanOrEqual(floor);
        });
      }

      it("keeps supporting text visibly quieter than the title", () => {
        const title = contrast(tokenColor("aw-text-primary", theme), surface());
        const muted = contrast(
          tokenColor("aw-node-text-muted", theme),
          surface(),
        );
        expect(muted).toBeLessThan(title);
      });
    });
  }

  it("uses a node-scoped muted token because the chrome one is too quiet for content", () => {
    // The regression this guards: someone "simplifies" --aw-node-text-muted
    // back to --aw-text-muted and silently drops the metrics row below the
    // body-text floor. The chrome token is deliberately under 4.5:1 — it is a
    // placeholder colour — so the node layer cannot borrow it.
    const chromeMuted = contrast(
      tokenColor("aw-text-muted", "light"),
      tokenColor("aw-surface-raised", "light"),
    );
    const nodeMuted = contrast(
      tokenColor("aw-node-text-muted", "light"),
      tokenColor("aw-surface-raised", "light"),
    );

    expect(chromeMuted).toBeLessThan(4.5);
    expect(nodeMuted).toBeGreaterThanOrEqual(4.5);
  });
});
