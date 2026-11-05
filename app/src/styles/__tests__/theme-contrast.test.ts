import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
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
 *   - primary, secondary and primary-light text: 4.5:1. All carry content.
 *   - muted text:                 3.0:1. Placeholders, hints, disabled copy —
 *                                 never content (the node layer uses
 *                                 --aw-node-text-muted for that).
 *   - status:                     3.0:1. Non-text UI and short labels.
 */

const INDEX_CSS = readFileSync(join("src", "index.css"), "utf-8");

const SURFACES = [
  { what: "page", token: "aw-surface" },
  { what: "raised", token: "aw-surface-raised" },
  { what: "overlay", token: "aw-surface-overlay" },
] as const;

const FOREGROUNDS = [
  { what: "primary text", token: "aw-text-primary", floor: 4.5 },
  { what: "secondary text", token: "aw-text-secondary", floor: 4.5 },
  { what: "muted text", token: "aw-text-muted", floor: 3 },
  // `dark:text-primary-light` writes secondary button labels, active nav items,
  // links and focus outlines, so the token is content in dark, not decoration.
  { what: "primary-light text", token: "aw-primary-light", floor: 4.5 },
  // The accent itself is body copy where it labels a link or a field.
  { what: "accent", token: "aw-primary", floor: 4.5 },
  { what: "success", token: "aw-status-success", floor: 3 },
  // Error is the one status that regularly carries a sentence — a validation
  // message, a destructive menu label — so it is held to the text floor, not
  // the non-text one. The dark token is #f87171, which is why it clears this.
  { what: "error", token: "aw-status-error", floor: 4.5 },
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

  it("resolves primary-light through the theme, not a static light-only hex", () => {
    // Every `dark:text-primary-light` / `dark:outline-primary-light` compiles
    // from --color-primary-light. While that was a literal #0f766e it could
    // not follow the theme, and the dark accent fell to 2.3:1 on zinc-900.
    expect(INDEX_CSS).toMatch(
      /--color-primary-light:\s*var\(--aw-primary-light\)/,
    );
    expect(isDeclared("aw-primary-light", "dark")).toBe(true);
    expect(tokenColor("aw-primary-light", "dark")).not.toEqual(
      tokenColor("aw-primary-light", "light"),
    );
  });

  it("resolves every status colour through the theme, not a static hex", () => {
    // `dark:text-status-error-dark` never existed as a token, so those classes
    // emitted no CSS and destructive items stayed light red (2.5:1) on dark.
    // The utility now follows the theme directly; these mappings are what make
    // that true, and a literal hex here is the regression.
    for (const role of ["success", "error", "warning", "running", "info"]) {
      expect(INDEX_CSS, `--color-status-${role} must alias --aw-status-${role}`).toMatch(
        new RegExp(`--color-status-${role}:\\s*var\\(--aw-status-${role}\\)`),
      );
      expect(isDeclared(`aw-status-${role}`, "dark")).toBe(true);
    }
    expect(tokenColor("aw-status-error", "dark")).not.toEqual(
      tokenColor("aw-status-error", "light"),
    );
  });
});

describe("primary fill", () => {
  // Button and IconButton `primary` share one pair: --aw-primary fill with
  // --aw-on-primary foreground, and --aw-primary-hover for the hover fill.
  for (const theme of ["light", "dark"] as const) {
    describe(theme, () => {
      for (const fill of ["aw-primary", "aw-primary-hover"] as const) {
        it(`on-primary reads on the ${fill} fill`, () => {
          const ratio = contrast(
            tokenColor("aw-on-primary", theme),
            tokenColor(fill, theme),
          );
          expect(
            ratio,
            `--aw-on-primary on --${fill} is ${ratio.toFixed(2)}:1`,
          ).toBeGreaterThanOrEqual(4.5);
        });
      }
    });
  }
});
