import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const readFiles = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return readFiles(fullPath);
    return /\.(ts|tsx)$/.test(entry.name) &&
      !entry.name.includes(".test.") &&
      !fullPath.includes(`${path.sep}__tests__${path.sep}`)
      ? [fullPath]
      : [];
  });

describe("no HTTP API for app data", () => {
  it("production code does not call fetch for app data", () => {
    for (const file of readFiles(path.resolve(__dirname, "../"))) {
      const content = fs.readFileSync(file, "utf-8");
      expect(content).not.toMatch(/fetch\([^)]*app:\/\/api/);
      expect(content).not.toMatch(/fetch\([^)]*localhost:8000/);
      expect(content).not.toMatch(/fetch\([^)]*127\.0\.0\.1:8000/);
    }
  });
});
