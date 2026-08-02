import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * A status colour must never have to be taken back.
 *
 * `--aw-status-running` was briefly set to the success hue, on the reasoning
 * that a run in flight and a run that passed are the same story at different
 * stages. `video/apiweave anim 3.mp4` is what that reasoning cost: a node sits
 * green-bordered with a green spinner and a green progress rail — pixel-for-pixel
 * a success — and half a second later it is a red `400 Bad Request`. The stub on
 * its outgoing edge went the same way, green then red.
 *
 * Running is the one state whose outcome is not known yet, so it cannot borrow
 * the colour of an outcome. Amber commits to nothing; green means passed and red
 * means failed, and neither is ever withdrawn.
 *
 * This guards the invariant rather than the specific hex, so retuning the palette
 * is free and collapsing running back onto an outcome is not.
 */

const BASE_CSS = readFileSync(join("src", "styles", "base.css"), "utf-8");

function tokenValue(name: string, theme: "light" | "dark"): string {
  const darkStart = BASE_CSS.indexOf(".dark,");
  const scope =
    theme === "light" ? BASE_CSS.slice(0, darkStart) : BASE_CSS.slice(darkStart);
  const declaration = scope.match(new RegExp(`--${name}:\\s*([^;]+);`));
  const value = declaration?.[1]?.trim();
  if (value === undefined) {
    if (theme === "dark") return tokenValue(name, "light");
    throw new Error(`--${name} is not declared in ${theme}`);
  }
  return value;
}

/** Hue in degrees, 0–360. Enough to tell yellow from green from red. */
function hue(hex: string): number {
  const clean = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map(
    (i) => parseInt(clean.substr(i, 2), 16) / 255,
  ) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const span = max - min;
  if (span === 0) return 0;

  let degrees: number;
  if (max === r) degrees = ((g - b) / span) % 6;
  else if (max === g) degrees = (b - r) / span + 2;
  else degrees = (r - g) / span + 4;

  return (degrees * 60 + 360) % 360;
}

/** Shortest distance around the colour wheel. */
function hueGap(a: string, b: string): number {
  const raw = Math.abs(hue(a) - hue(b));
  return Math.min(raw, 360 - raw);
}

const THEMES = ["light", "dark"] as const;

describe("status hues", () => {
  for (const theme of THEMES) {
    it(`keeps running distinct from every outcome it might not reach (${theme})`, () => {
      const running = tokenValue("aw-status-running", theme);

      for (const outcome of ["aw-status-success", "aw-status-error"]) {
        const value = tokenValue(outcome, theme);
        expect(
          hueGap(running, value),
          `--aw-status-running and --${outcome} are ${Math.round(
            hueGap(running, value),
          )}° apart in ${theme}. A node that is still working must not be ` +
            "wearing the colour of a result it has not produced — when it fails, " +
            "the canvas has to withdraw a claim it should never have made.",
        ).toBeGreaterThan(25);
      }
    });

    it(`keeps running legible next to warning (${theme})`, () => {
      // Both are amber; they are separated by hue *and* by glyph (a spinner is
      // not a warning triangle), per the no-colour-only-status rule. This only
      // asserts they are not literally the same swatch.
      const running = tokenValue("aw-status-running", theme);
      const warning = tokenValue("aw-status-warning", theme);
      expect(running).not.toBe(warning);
    });
  }
});
