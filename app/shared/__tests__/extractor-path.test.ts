import { describe, expect, test } from "vitest"
import {
  buildBodyExtractorPath,
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
