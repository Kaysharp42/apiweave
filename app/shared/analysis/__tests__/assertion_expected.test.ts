import { describe, expect, it } from "vitest"
import { assertionExpectedProblem, parseRegexSource } from "../assertion_expected"

describe("assertionExpectedProblem", () => {
  it("accepts well-shaped values and placeholders", () => {
    expect(assertionExpectedProblem("type", "integer")).toBeNull()
    expect(assertionExpectedProblem("matches", "/^ok$/i")).toBeNull()
    expect(assertionExpectedProblem("notMatches", "{{variables.pattern}}")).toBeNull()
    expect(assertionExpectedProblem("matchesSchema", { type: "object" })).toBeNull()
    expect(assertionExpectedProblem("matchesSchema", '{"type": "object"}')).toBeNull()
    expect(assertionExpectedProblem("equals", { any: "thing" })).toBeNull()
  })

  it("names what is wrong with a misshapen one", () => {
    expect(assertionExpectedProblem("type", "text")).toMatch(/one of string, number, integer/)
    expect(assertionExpectedProblem("matches", "(unclosed")).toMatch(/Invalid regular expression/)
    expect(assertionExpectedProblem("matches", 5)).toMatch(/expects a regular expression/)
    expect(assertionExpectedProblem("matchesSchema", "[1]")).toMatch(/JSON Schema object/)
  })

  it("reads /pattern/flags as a literal and anything else as a bare pattern", () => {
    expect(parseRegexSource("/^a\\/b$/im")).toEqual({ pattern: "^a\\/b$", flags: "im" })
    expect(parseRegexSource("^/api/v1")).toEqual({ pattern: "^/api/v1", flags: "" })
  })
})
