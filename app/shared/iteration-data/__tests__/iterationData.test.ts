import { describe, expect, it } from "vitest"
import { MAX_ITERATION_ROWS, parseCsv, parseIterationData } from "../iterationData"

describe("parseCsv", () => {
  it.each([
    ["plain LF", "a,b\n1,2\n", [["a", "b"], ["1", "2"]]],
    ["CRLF and no trailing newline", "a,b\r\n1,2", [["a", "b"], ["1", "2"]]],
    ["lone CR", "a,b\r1,2\r", [["a", "b"], ["1", "2"]]],
    ["BOM", "﻿a,b\n1,2", [["a", "b"], ["1", "2"]]],
    ["quoted comma and newline", 'a,b\n"x,y","line1\r\nline2"', [["a", "b"], ["x,y", "line1\r\nline2"]]],
    ["escaped quotes", 'a\n"say ""hi"""', [["a"], ['say "hi"']]],
    ["empty fields", "a,b,c\n,,\n", [["a", "b", "c"], ["", "", ""]]],
    ["blank lines skipped", "a\n\n1\n\n", [["a"], ["1"]]],
    ["quoted empty value is a record", 'a\n""\n', [["a"], [""]]],
    ["quoted empty value at the end", 'a\n""', [["a"], [""]]],
    ["trailing empty field", "a,b\n1,", [["a", "b"], ["1", ""]]],
  ])("%s", (_name, text, expected) => {
    expect(parseCsv(text)).toEqual(expected)
  })

  it("rejects an unterminated quote", () => {
    expect(() => parseCsv('a\n"open')).toThrow("unterminated quoted field")
  })
})

describe("parseIterationData", () => {
  it("maps CSV rows onto the header's column names", () => {
    expect(parseIterationData("user,id\nann,1\nbob,2\n", "users.csv")).toEqual([
      { user: "ann", id: "1" },
      { user: "bob", id: "2" },
    ])
  })

  it("keeps JSON values and nesting", () => {
    expect(parseIterationData('[{"id":1,"tags":["a"],"ok":true}]', "rows.JSON")).toEqual([{ id: 1, tags: ["a"], ok: true }])
  })

  it.each([
    ["users.csv", "user\n", "has no data rows"],
    ["users.csv", "a,a\n1,2", "names column 'a' twice"],
    ["users.csv", "a,\n1,2", "empty column name"],
    ["users.csv", "a,b\n1", "CSV row 1 has 1 fields; the header has 2"],
    ["rows.json", "{}", "array of objects"],
    ["rows.json", "[1]", "row 1 is not an object"],
    ["rows.json", "[", "not valid JSON"],
    ["rows.json", "[]", "has no data rows"],
  ])("rejects %s %j", (fileName, text, message) => {
    expect(() => parseIterationData(text, fileName)).toThrow(message)
  })

  it("caps the row count", () => {
    const text = `n\n${"1\n".repeat(MAX_ITERATION_ROWS + 1)}`
    expect(() => parseIterationData(text, "big.csv")).toThrow(`the limit is ${MAX_ITERATION_ROWS}`)
  })
})
