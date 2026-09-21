import { describe, expect, it } from "vitest";
import { AssertionItemSchema } from "@shared/zod-schemas";
import { findTutorialLesson } from "./curriculum";

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

  it("import-export secret reference example names a scope for every entry", () => {
    const lesson = findTutorialLesson("import-export");
    expect(lesson).not.toBeNull();

    const parsed = JSON.parse(lesson!.example.code) as {
      schemaVersion?: unknown;
      type?: unknown;
      secretReferences?: unknown;
    };

    expect(parsed.type).toBe("awecollection");
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
