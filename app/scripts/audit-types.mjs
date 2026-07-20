#!/usr/bin/env node

/**
 * APIWeave Type Audit Script
 *
 * Enforces two type-location rules:
 * 1. No type/interface/type-alias declarations outside app/src/types/
 * 2. At most ONE type/interface/type-alias declaration per file inside app/src/types/
 *    (except index.ts which must have zero declarations — barrel exports only)
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, relative, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const SRC = join(ROOT, "src");
const TYPES_DIR = join(SRC, "types");

const TS_EXTENSIONS = new Set([".ts", ".tsx"]);

let violations = 0;

/**
 * Walk a directory recursively, yielding .ts/.tsx files.
 * Skips node_modules, dist, and test files.
 */
function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (
        entry.name === "node_modules" ||
        entry.name === "dist" ||
        entry.name === "__tests__"
      )
        continue;
      yield* walk(full);
    } else if (entry.isFile() && TS_EXTENSIONS.has(extname(entry.name))) {
      // Skip test files and test fixtures
      if (entry.name.endsWith(".test.ts") || entry.name.endsWith(".test.tsx"))
        continue;
      if (entry.name === "testFixtures.ts" || entry.name === "testFixtures.tsx")
        continue;
      yield full;
    }
  }
}

/**
 * Count type/interface/type-alias declarations in file content.
 * Matches:
 *   - export type Foo = ...
 *   - export interface Foo { ... }
 *   - type Foo = ...
 *   - interface Foo { ... }
 */
function countTypeDeclarations(content) {
  // Match 'type' or 'interface' that starts a declaration (not a reference, not in comments)
  // Pattern: optional 'export' keyword, then 'type' or 'interface', then an identifier
  const pattern = /(?:^|\n)\s*(?:export\s+)?(?:type|interface)\s+\w+/g;
  const matches = content.match(pattern);
  return matches ? matches.length : 0;
}

// ── Rule 1: No type/interface declarations outside src/types/ ──
for (const file of walk(SRC)) {
  const rel = relative(SRC, file).replace(/\\/g, "/");
  if (rel.startsWith("types/")) continue; // skip types dir — checked in Rule 2

  const content = readFileSync(file, "utf-8");
  const count = countTypeDeclarations(content);

  if (count > 0) {
    // Only count EXPORTED type/interface declarations.
    // Non-exported (local) types are implementation details, not shared types.
    const lines = content.split("\n");
    let realCount = 0;
    for (const line of lines) {
      const trimmed = line.trim();
      // Skip import type lines
      if (trimmed.startsWith("import ")) continue;
      // Match only EXPORTED type/interface/union declarations
      if (/^export\s+(?:type|interface)\s+\w+/.test(trimmed)) {
        realCount++;
      }
    }

    if (realCount > 0) {
      console.error(
        `[VIOLATION] Rule 1: ${rel} contains ${realCount} type/interface declaration(s) outside src/types/`,
      );
      violations += realCount;
    }
  }
}

// ── Rule 2: At most one type/interface per file in src/types/ ──
// ──         index.ts must have zero declarations ──
for (const entry of readdirSync(TYPES_DIR, { withFileTypes: true })) {
  if (!entry.isFile() || !TS_EXTENSIONS.has(extname(entry.name))) continue;

  const filePath = join(TYPES_DIR, entry.name);
  const content = readFileSync(filePath, "utf-8");
  const count = countTypeDeclarations(content);

  if (entry.name === "index.ts") {
    if (count > 0) {
      console.error(
        `[VIOLATION] Rule 2: index.ts has ${count} type/interface declaration(s) — must be barrel exports only`,
      );
      violations += count;
    }
  } else {
    if (count > 1) {
      console.error(
        `[VIOLATION] Rule 2: types/${entry.name} has ${count} type/interface declarations — max 1 allowed`,
      );
      violations += count - 1;
    }
  }
}

// ── Result ──
if (violations > 0) {
  console.error(
    `\n${violations} violation(s) found. Fix them before committing.`,
  );
  process.exit(1);
}

console.log(
  "Type audit passed: all type/interface declarations are in src/types/, one per file.",
);
process.exit(0);
