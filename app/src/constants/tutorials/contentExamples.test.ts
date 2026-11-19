import { describe, expect, it } from "vitest";
import { AssertionItemSchema } from "@shared/zod-schemas";
import { BrowserNodeDataSchema } from "@shared/zod-schemas/BrowserNodeDataSchema";
import { findTutorialLesson } from "./curriculum";

/** The parsed JSON example of a lesson, asserting it is declared as JSON. */
function jsonExample(lessonId: string): unknown {
  const lesson = findTutorialLesson(lessonId);
  expect(lesson).not.toBeNull();
  expect(lesson?.example.language).toBe("json");
  return JSON.parse(lesson?.example.code ?? "null") as unknown;
}

/** Every entry of a JSON array example, asserting the example is a non-empty array. */
function jsonArrayExample(lessonId: string): unknown[] {
  const parsed = jsonExample(lessonId);
  expect(Array.isArray(parsed)).toBe(true);
  const entries = parsed as unknown[];
  expect(entries.length).toBeGreaterThan(0);
  return entries;
}

/**
 * Validates the tutorial's *structured* examples against the schemas the app
 * actually ships, so a lesson example cannot describe a config the runner or
 * persistence boundary would reject. Prose is deliberately not asserted here —
 * only data the reader is expected to paste.
 */
describe("tutorial structured examples", () => {
  it("assertions lesson example is a valid assertion rule array", () => {
    const lesson = findTutorialLesson("assertions");
    expect(lesson).not.toBeNull();
    expect(lesson?.example.language).toBe("json");

    const parsed: unknown = JSON.parse(lesson!.example.code);
    expect(Array.isArray(parsed)).toBe(true);

    const rules = parsed as unknown[];
    expect(rules.length).toBeGreaterThan(0);
    for (const rule of rules) {
      const result = AssertionItemSchema.safeParse(rule);
      expect(result.success).toBe(true);
    }
  });

  it("snapshot lesson example is a valid assertion rule array with a snapshot rule", () => {
    const rules = jsonArrayExample("snapshots-contracts");
    for (const rule of rules) {
      expect(AssertionItemSchema.safeParse(rule).success).toBe(true);
    }
    expect(rules).toContainEqual(
      expect.objectContaining({ operator: "matchesSnapshot" }),
    );
  });

  it("browser recording example is a chain of valid browser step configs", () => {
    for (const step of jsonArrayExample("browser-record")) {
      expect(BrowserNodeDataSchema.safeParse(step).success).toBe(true);
    }
  });

  it("browser fix example is a valid extract step", () => {
    const parsed = BrowserNodeDataSchema.safeParse(jsonExample("browser-fix"));
    expect(parsed.success).toBe(true);
    expect(parsed.data?.action).toBe("extract");
  });

  it("import-export secret reference example names a scope for every entry", () => {
    const lesson = findTutorialLesson("import-export");
    expect(lesson).not.toBeNull();

    const parsed = JSON.parse(lesson!.example.code) as {
      schemaVersion?: unknown;
      type?: unknown;
      secretReferences?: unknown;
    };

    expect(parsed.type).toBe("aweproject");
    expect(typeof parsed.schemaVersion).toBe("string");
    expect(Array.isArray(parsed.secretReferences)).toBe(true);

    // `ProjectExportService.validateBundle` requires name, scopeType and
    // scopeId as strings; an example missing one would be rejected on import.
    for (const reference of parsed.secretReferences as unknown[]) {
      expect(reference).toMatchObject({
        name: expect.any(String),
        scopeType: expect.any(String),
        scopeId: expect.any(String),
      });
    }
  });
});
