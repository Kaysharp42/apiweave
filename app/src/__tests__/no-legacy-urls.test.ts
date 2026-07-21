/**
 * Legacy API URL guard — static scan for old flat routes.
 *
 * Scans production source files for legacy flat API URL patterns
 * (/api/workflows, /api/environments, /api/collections) that must
 * not appear in frontend production code after the scoped-API migration.
 *
 * MODES (via LEGACY_GUARD_MODE env):
 *   - strict (default): Fail on any match. Used after migration (Task 13/15).
 *   - report:           List all matches, exit 0. Set LEGACY_GUARD_MODE=report for inventory.
 *
 * EXCLUSIONS:
 *   - Files inside __tests__ directories (test fixtures, deprecation tests)
 *   - Lines annotated with `// @legacy-allowed: <reason>` marker
 *
 * TypeScript STRICT: No `any` types.
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

// ─── Configuration ───────────────────────────────────────────────────────────

const SRC_DIR = path.resolve(__dirname, "..");

const LEGACY_PATTERNS: readonly string[] = [
  "/api/workflows",
  "/api/environments",
  "/api/collections",
];

const FIXTURE_FILE = path.resolve(
  __dirname,
  "fixtures",
  "strict-mode-fixture.ts",
);

/** Lines containing this annotation are exempt from the guard. */
const LEGACY_ALLOWED_MARKER = "// @legacy-allowed:";

const mode: string = process.env.LEGACY_GUARD_MODE || "strict";
const isStrict: boolean = mode === "strict";

// ─── Types ───────────────────────────────────────────────────────────────────

interface Match {
  /** Path relative to SRC_DIR, forward slashes */
  file: string;
  /** 1-based line number */
  line: number;
  /** Trimmed line content */
  content: string;
}

// ─── Scanning helpers ────────────────────────────────────────────────────────

/**
 * Returns all .ts and .tsx files under `dir`, EXCLUDING files inside
 * any directory named `__tests__` at any nesting level.
 */
function collectProductionFiles(dir: string): string[] {
  const results: string[] = [];

  function walk(current: string): void {
    const entries: fs.Dirent[] = fs.readdirSync(current, {
      withFileTypes: true,
    });

    for (const entry of entries) {
      // Skip hidden dirs, node_modules, and test directories
      if (entry.name === "node_modules") continue;
      if (entry.name.startsWith(".")) continue;
      if (entry.name === "__tests__") continue;

      const fullPath: string = path.join(current, entry.name);

      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
        results.push(fullPath);
      }
    }
  }

  walk(dir);
  return results;
}

/**
 * Search a list of files for legacy URL patterns.
 * Returns matches sorted by file path then line number.
 */
function findMatches(files: string[]): Match[] {
  const results: Match[] = [];

  for (const file of files) {
    const relativePath: string = path
      .relative(SRC_DIR, file)
      .replace(/\\/g, "/");

    const content: string = fs.readFileSync(file, "utf-8");
    const lines: string[] = content.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const lineText: string = lines[i]!;

      // Skip lines with the legacy-allowed annotation
      if (lineText.includes(LEGACY_ALLOWED_MARKER)) continue;

      for (const pattern of LEGACY_PATTERNS) {
        if (lineText.includes(pattern)) {
          results.push({
            file: relativePath,
            line: i + 1,
            content: lineText.trim(),
          });
          // Don't break - a line could match multiple patterns
          // (though unlikely in practice)
        }
      }
    }
  }

  // Deduplicate (same file, same line, same content)
  const seen = new Set<string>();
  const deduped: Match[] = [];

  for (const match of results) {
    const key = `${match.file}:${match.line}:${match.content}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(match);
    }
  }

  deduped.sort((a, b) => {
    if (a.file < b.file) return -1;
    if (a.file > b.file) return 1;
    return a.line - b.line;
  });

  return deduped;
}

// ─── Scan production source files ────────────────────────────────────────────

const productionFiles: string[] = collectProductionFiles(SRC_DIR);
const matches: Match[] = findMatches(productionFiles);

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("Legacy API URL guard", () => {
  if (matches.length > 0) {
    const reportLines: string[] = matches.map(
      (m) => `  ${m.file}:${m.line}  ${m.content}`,
    );

    // Always print the report
    it("should report all legacy URL locations (report)", () => {
      console.log(`\n=== Legacy URL Report (${matches.length} matches) ===`);
      for (const line of reportLines) {
        console.log(line);
      }
      console.log("========================================\n");
      expect(true).toBe(true);
    });
  } else {
    it("should confirm no legacy URLs found", () => {
      console.log(
        "\n=== No legacy URL patterns found in production code ===\n",
      );
      expect(true).toBe(true);
    });
  }

  if (isStrict && matches.length > 0) {
    it("should NOT contain legacy API URL patterns in production code (strict)", () => {
      const reportLines: string[] = matches.map(
        (m) => `  ${m.file}:${m.line}  ${m.content}`,
      );
      expect(
        matches,
        `Found ${matches.length} legacy URL(s) in production code:\n${reportLines.join("\n")}`,
      ).toHaveLength(0);
    });
  }
});

// ─── Fixture self-test ───────────────────────────────────────────────────────
// Verifies the guard's detection logic works by scanning a known-bad fixture.

describe("Guard self-test with fixture", () => {
  it("should detect the legacy URL in the strict-mode fixture file", () => {
    const fixtureFile: string = FIXTURE_FILE;

    expect(
      fs.existsSync(fixtureFile),
      `Fixture not found: ${fixtureFile}`,
    ).toBe(true);

    const content: string = fs.readFileSync(fixtureFile, "utf-8");
    const lines: string[] = content.split("\n");
    const fixtureMatches: Match[] = [];

    for (let i = 0; i < lines.length; i++) {
      const lineText: string = lines[i]!;
      for (const pattern of LEGACY_PATTERNS) {
        if (lineText.includes(pattern)) {
          fixtureMatches.push({
            file: path.relative(SRC_DIR, fixtureFile).replace(/\\/g, "/"),
            line: i + 1,
            content: lineText.trim(),
          });
        }
      }
    }

    expect(
      fixtureMatches.length,
      `Fixture test failed: expected to find legacy URL in fixture file, got ${fixtureMatches.length} matches`,
    ).toBeGreaterThanOrEqual(1);

    console.log(
      `\n=== Fixture self-test passed — ${fixtureMatches.length} match(es) detected ===`,
    );
    for (const m of fixtureMatches) {
      console.log(`  ${m.file}:${m.line}  ${m.content}`);
    }
    console.log("");
  });
});
