import { describe, it, expect } from "vitest";
import {
  applyTemplateSuggestion,
  filterTemplateSuggestions,
  findTemplateToken,
} from "./templateAutocomplete";
import type { TemplateSuggestion } from "../types/TemplateSuggestion";

const SUGGESTIONS: readonly TemplateSuggestion[] = [
  { insert: "variables.assetRef", kind: "variable" },
  { insert: "variables.token", kind: "variable" },
  { insert: "env.BASE_URL", kind: "env" },
  { insert: "secrets.API_KEY", kind: "secret" },
  { insert: "uuid()", kind: "function" },
  { insert: "randomString()", kind: "function", caretOffset: 13 },
];

describe("findTemplateToken", () => {
  it("opens on the braces the caret sits after", () => {
    expect(findTemplateToken("{{var", 5)).toEqual({ start: 0, query: "var" });
    expect(findTemplateToken("GET {{env.", 10)).toEqual({
      start: 4,
      query: "env.",
    });
  });

  it("stays shut once the reference is closed and the caret has moved on", () => {
    expect(findTemplateToken("{{variables.a}} and ", 20)).toBeNull();
    expect(findTemplateToken("no braces here", 5)).toBeNull();
  });

  it("reopens inside a reference the user is editing", () => {
    expect(findTemplateToken("{{variables.a}}", 13)).toEqual({
      start: 0,
      query: "variables.a",
    });
  });

  it("gives up on a run too long to be a reference", () => {
    expect(findTemplateToken(`{{${"x".repeat(65)}`, 67)).toBeNull();
  });

  it("only reads the text before the caret", () => {
    expect(findTemplateToken("{{env.A}} {{sec", 7)).toEqual({
      start: 0,
      query: "env.A",
    });
  });
});

describe("filterTemplateSuggestions", () => {
  it("shows everything, in source order, for an empty query", () => {
    expect(filterTemplateSuggestions("", SUGGESTIONS)).toHaveLength(
      SUGGESTIONS.length,
    );
  });

  it("puts prefix matches ahead of looser ones", () => {
    const results = filterTemplateSuggestions("var", SUGGESTIONS).map(
      (r) => r.insert,
    );
    expect(results.slice(0, 2)).toEqual([
      "variables.assetRef",
      "variables.token",
    ]);
    // `env.BASE_URL` matches only by subsequence (v…a…r), so it may appear —
    // but never above something that actually starts with what was typed.
    expect(results.indexOf("env.BASE_URL")).toBeGreaterThan(1);
  });

  it("still matches a mistyped namespace by subsequence", () => {
    const results = filterTemplateSuggestions("variable.", SUGGESTIONS);
    expect(results.map((r) => r.insert)).toEqual([
      "variables.assetRef",
      "variables.token",
    ]);
  });

  it("matches on the tail of a reference", () => {
    expect(filterTemplateSuggestions("token", SUGGESTIONS)[0]?.insert).toBe(
      "variables.token",
    );
  });

  it("matches punctuation literally", () => {
    expect(filterTemplateSuggestions("uuid(", SUGGESTIONS)[0]?.insert).toBe(
      "uuid()",
    );
  });
});

describe("applyTemplateSuggestion", () => {
  it("closes the braces and lands the caret after them", () => {
    const token = findTemplateToken("{{var", 5)!;
    expect(applyTemplateSuggestion("{{var", 5, token, SUGGESTIONS[1]!)).toEqual(
      {
        text: "{{variables.token}}",
        caret: 19,
      },
    );
  });

  it("does not double the braces of a reference already closed", () => {
    const text = "url/{{var}}/x";
    const token = findTemplateToken(text, 9)!;
    expect(applyTemplateSuggestion(text, 9, token, SUGGESTIONS[1]!)).toEqual({
      text: "url/{{variables.token}}/x",
      caret: 23,
    });
  });

  it("parks the caret inside the parens of a function that takes an argument", () => {
    const token = findTemplateToken("{{random", 8)!;
    const edit = applyTemplateSuggestion("{{random", 8, token, SUGGESTIONS[5]!);
    expect(edit.text).toBe("{{randomString()}}");
    expect(edit.text.slice(edit.caret)).toBe(")}}");
  });

  it("keeps the text on both sides of the reference", () => {
    const text = "https://api/{{env}}/users";
    const token = findTemplateToken(text, 17)!;
    expect(applyTemplateSuggestion(text, 17, token, SUGGESTIONS[2]!).text).toBe(
      "https://api/{{env.BASE_URL}}/users",
    );
  });
});
