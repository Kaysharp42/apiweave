import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * An `@import` that follows any other statement is invalid CSS, and the build
 * does not fail on it: it warns and drops the import. Dropping `base.css` that
 * way removes every design token and the global resets while every test and
 * typecheck still passes, so the order is pinned here.
 */
describe("src/index.css", () => {
  it("puts every @import before any other statement", () => {
    const css = readFileSync(join("src", "index.css"), "utf-8").replace(
      /\/\*[\s\S]*?\*\//g,
      "",
    );
    const statements = css
      .split("\n")
      .filter((line) => /^\S/.test(line))
      .map((line) => line.trim());

    const firstOther = statements.findIndex(
      (line) => !line.startsWith("@import "),
    );
    const lastImport = statements.findLastIndex((line) =>
      line.startsWith("@import "),
    );

    expect(lastImport, "index.css must import Tailwind").toBeGreaterThanOrEqual(
      0,
    );
    expect(
      firstOther === -1 || lastImport < firstOther,
      `"${statements[firstOther]}" precedes an @import`,
    ).toBe(true);
  });
});
