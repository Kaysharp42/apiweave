import { describe, expect, it } from "vitest"
import { parseDotenv, parseVariablesFile, toDotenv } from "../envFile"

describe("parseDotenv", () => {
  it("reads comments, export, quotes, inline comments and multiline values", () => {
    const text = [
      "# a comment",
      "",
      "export BASE_URL=https://api.test/v1",
      "  SPACED = padded value   # trailing comment",
      "HASHED=a#b",
      "SINGLE='literal \\n #kept'",
      'DOUBLE="tab\\there \\"quoted\\" back\\\\slash" # comment',
      'MULTI="line one',
      'line two"',
      "TICK=`one",
      "two`",
      "EMPTY=",
      "not an assignment",
      "EQUALS=a=b",
      "BASE_URL=https://override.test",
    ].join("\r\n")

    expect(parseDotenv(text)).toEqual({
      BASE_URL: "https://override.test",
      SPACED: "padded value",
      HASHED: "a",
      SINGLE: "literal \\n #kept",
      DOUBLE: 'tab\there "quoted" back\\slash',
      MULTI: "line one\nline two",
      TICK: "one\ntwo",
      EMPTY: "",
      EQUALS: "a=b",
    })
  })

  it("reads an unclosed quote as the rest of its line", () => {
    expect(parseDotenv('A="open\nB=2')).toEqual({ A: '"open', B: "2" })
  })

  it("does not let a key named __proto__ touch the prototype", () => {
    const parsed = parseDotenv("__proto__=x")
    expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype)
    expect(Object.keys(parsed)).toEqual(["__proto__"])
  })
})

describe("toDotenv", () => {
  it("round-trips through parseDotenv and skips keys dotenv cannot name", () => {
    const variables = {
      PLAIN: "https://api.test/v1?x=1",
      SPACES: " padded ",
      SPECIAL: 'say "hi" # not a comment \\n',
      LINES: "one\ntwo\r\nthree",
      EMPTY: "",
      "bad key": "x",
    }
    const text = toDotenv(variables)

    expect(text).toContain("PLAIN=https://api.test/v1?x=1\n")
    expect(text).toContain('# skipped "bad key"')
    const expressible = Object.fromEntries(Object.entries(variables).filter(([key]) => key !== "bad key"))
    expect(parseDotenv(text)).toEqual(expressible)
  })
})

describe("parseVariablesFile", () => {
  it("suggests a secret for credential-named keys and credential-shaped values", () => {
    const file = parseVariablesFile("BASE_URL=https://api.test\nAPI_KEY=abc\nHEADER=Bearer abc123.def\nUSER=bob\n")
    expect(file.format).toBe("dotenv")
    expect(file.variables.map((v) => [v.key, v.suggestSecret])).toEqual([
      ["BASE_URL", false],
      ["API_KEY", true],
      ["HEADER", true],
      ["USER", false],
    ])
  })

  it("reads a flat JSON object, stringifying scalars", () => {
    const file = parseVariablesFile('{ "host": "api.test", "port": 8080, "debug": true, "none": null, "client_secret": "s" }')
    expect(file.format).toBe("json")
    expect(file.variables).toEqual([
      { key: "host", value: "api.test", suggestSecret: false },
      { key: "port", value: "8080", suggestSecret: false },
      { key: "debug", value: "true", suggestSecret: false },
      { key: "none", value: "", suggestSecret: false },
      { key: "client_secret", value: "s", suggestSecret: true },
    ])
  })

  it("rejects nested JSON, naming the key", () => {
    expect(() => parseVariablesFile('{ "db": { "host": "x" } }')).toThrow('"db" holds an object')
    expect(() => parseVariablesFile('{ "hosts": ["a"] }')).toThrow('"hosts" holds an array')
    expect(() => parseVariablesFile("{ nope")).toThrow(SyntaxError)
  })

  it("reads a Postman environment, skipping disabled entries and honouring its secret type", () => {
    const file = parseVariablesFile(JSON.stringify({
      name: "Staging",
      values: [
        { key: "baseUrl", value: "https://staging.test", enabled: true },
        { key: "session", value: "abc", type: "secret", enabled: true },
        { key: "old", value: "x", enabled: false },
        { key: "", value: "blank" },
        { key: "retries", value: 3 },
      ],
    }))
    expect(file.format).toBe("postman")
    expect(file.variables).toEqual([
      { key: "baseUrl", value: "https://staging.test", suggestSecret: false },
      { key: "session", value: "abc", suggestSecret: true },
      { key: "retries", value: "3", suggestSecret: false },
    ])
  })
})
