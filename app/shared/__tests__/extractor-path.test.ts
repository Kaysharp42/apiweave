import { describe, expect, test } from "vitest"
import {
  buildBodyExtractorPath,
  isJsonPath,
  isValidJsonPath,
  resolveExtractorPath,
} from "../extractors/extractorPath"

const nodeResult = {
  status: "success",
  body: { id: "abc", items: [{ id: "first" }, { id: "second" }] },
  response: {
    statusCode: 201,
    body: {
      id: "abc",
      nested: { deep: { value: 7 } },
      items: [{ id: "first" }, { id: "second" }],
      "dashed-key": "kept",
      nothing: null,
    },
    headers: { etag: "W/123" },
  },
}

describe("buildBodyExtractorPath", () => {
  test("builds dotted paths rooted at response.body", () => {
    expect(buildBodyExtractorPath([])).toEqual({
      supported: true,
      path: "response.body",
    })
    expect(buildBodyExtractorPath(["id"])).toEqual({
      supported: true,
      path: "response.body.id",
    })
    expect(buildBodyExtractorPath(["nested", "deep", "value"])).toEqual({
      supported: true,
      path: "response.body.nested.deep.value",
    })
  })

  test("folds array indices into the owning key", () => {
    expect(buildBodyExtractorPath(["items", 1, "id"])).toEqual({
      supported: true,
      path: "response.body.items[1].id",
    })
    expect(buildBodyExtractorPath([0, "id"])).toEqual({
      supported: true,
      path: "response.body[0].id",
    })
  })

  test("keeps non-identifier keys that the runner still resolves", () => {
    expect(buildBodyExtractorPath(["dashed-key"])).toEqual({
      supported: true,
      path: "response.body.dashed-key",
    })
  })

  test("reports locations the grammar cannot address", () => {
    expect(buildBodyExtractorPath(["matrix", 0, 1]).supported).toBe(false)
    expect(buildBodyExtractorPath(["dashed-key", 0]).supported).toBe(false)
    expect(buildBodyExtractorPath(["a.b"]).supported).toBe(false)
    expect(buildBodyExtractorPath([""]).supported).toBe(false)
  })
})

describe("resolveExtractorPath", () => {
  test("resolves every path the builder reports as supported", () => {
    const build = buildBodyExtractorPath(["items", 1, "id"])
    expect(build.supported).toBe(true)
    if (!build.supported) return

    expect(resolveExtractorPath(nodeResult, build.path)).toEqual({
      value: "second",
      failureReason: null,
    })
  })

  test("resolves nested values, headers and non-identifier keys", () => {
    expect(
      resolveExtractorPath(nodeResult, "response.body.nested.deep.value").value,
    ).toBe(7)
    expect(resolveExtractorPath(nodeResult, "response.headers.etag").value).toBe(
      "W/123",
    )
    expect(
      resolveExtractorPath(nodeResult, "response.body.dashed-key").value,
    ).toBe("kept")
  })

  test("distinguishes a missing path from a shape mismatch", () => {
    expect(
      resolveExtractorPath(nodeResult, "response.body.missing").failureReason,
    ).toBe("path-missing")
    expect(
      resolveExtractorPath(nodeResult, "response.body.items[9].id")
        .failureReason,
    ).toBe("path-missing")
    expect(
      resolveExtractorPath(nodeResult, "response.body.id.deeper").failureReason,
    ).toBe("type-mismatch")
    expect(
      resolveExtractorPath(nodeResult, "response.body.nothing.deeper")
        .failureReason,
    ).toBe("type-mismatch")
  })

  test("treats an empty path and empty data as missing", () => {
    expect(resolveExtractorPath(nodeResult, "").failureReason).toBe(
      "path-missing",
    )
    expect(resolveExtractorPath(null, "response.body.id").failureReason).toBe(
      "path-missing",
    )
  })
})

describe("resolveExtractorPath JSONPath", () => {
  test("resolves a singular JSONPath to the selected value", () => {
    expect(resolveExtractorPath(nodeResult, "$.response.body.id")).toEqual({
      value: "abc",
      failureReason: null,
    })
    expect(
      resolveExtractorPath(nodeResult, "$.response.body.nested.deep.value")
        .value,
    ).toBe(7)
    expect(resolveExtractorPath(nodeResult, "$.response.body.items[1].id").value).toBe(
      "second",
    )
  })

  test("resolves a non-singular JSONPath to an array of matches", () => {
    expect(
      resolveExtractorPath(nodeResult, "$.response.body.items[*].id").value,
    ).toEqual(["first", "second"])
    expect(
      resolveExtractorPath(nodeResult, "$.response.body.items[?@.id=='second'].id")
        .value,
    ).toEqual(["second"])
  })

  test("supports RFC 9535 filter syntax without parentheses", () => {
    expect(
      resolveExtractorPath(nodeResult, "$.response.body.items[?@.id=='first'].id")
        .value,
    ).toEqual(["first"])
  })

  test("a query that matches nothing is path-missing", () => {
    expect(
      resolveExtractorPath(nodeResult, "$.response.body.missing").failureReason,
    ).toBe("path-missing")
    expect(
      resolveExtractorPath(nodeResult, "$.response.body.items[?@.id=='nope'].id")
        .failureReason,
    ).toBe("path-missing")
    expect(resolveExtractorPath(nodeResult, "$..missing").failureReason).toBe(
      "path-missing",
    )
  })

  test("an invalid expression is a distinct invalid-path failure", () => {
    expect(resolveExtractorPath(nodeResult, "$.response.body[").failureReason).toBe(
      "invalid-path",
    )
    expect(resolveExtractorPath(nodeResult, "$.").failureReason).toBe(
      "invalid-path",
    )
  })

  test("a singular query selecting an array returns the array itself", () => {
    expect(resolveExtractorPath(nodeResult, "$.response.body.items").value).toEqual([
      { id: "first" },
      { id: "second" },
    ])
  })
})

describe("isJsonPath / isValidJsonPath", () => {
  test("dispatches only $-prefixed paths to JSONPath", () => {
    expect(isJsonPath("$.a")).toBe(true)
    expect(isJsonPath("$")).toBe(true)
    expect(isJsonPath("response.body.id")).toBe(false)
    expect(isJsonPath("")).toBe(false)
  })

  test("accepts valid RFC 9535 expressions and rejects invalid ones", () => {
    expect(isValidJsonPath("$.response.body.items[?@.id==3].name")).toBe(true)
    expect(isValidJsonPath("$")).toBe(true)
    expect(isValidJsonPath("$.response.body[")).toBe(false)
    expect(isValidJsonPath("$.")).toBe(false)
    expect(isValidJsonPath("response.body.id")).toBe(false)
    expect(isValidJsonPath("")).toBe(false)
  })
})
