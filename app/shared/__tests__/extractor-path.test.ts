import { describe, expect, test } from "vitest"
import {
  buildBodyExtractorPath,
  isJsonPath,
  isValidJsonPath,
  isXPath,
  isValidXPath,
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

/** A SOAP 1.1 envelope with a namespaced payload, the shape the XPath branch reads. */
const soapEnvelope = `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:t="urn:temperature">
  <soap:Body>
    <t:GetTemperatureResponse>
      <t:Place>Oslo</t:Place>
      <t:Total unit="C">-4.5</t:Total>
      <t:Reading hour="06">-6</t:Reading>
      <t:Reading hour="12">-3</t:Reading>
    </t:GetTemperatureResponse>
  </soap:Body>
</soap:Envelope>`

const soapResult = {
  statusCode: 200,
  response: { statusCode: 200, body: soapEnvelope, headers: { "content-type": "text/xml" } },
}

describe("resolveExtractorPath XPath", () => {
  test("reads a namespaced element by a prefix the document declares", () => {
    expect(resolveExtractorPath(soapResult, "xpath:/soap:Envelope/soap:Body/t:GetTemperatureResponse/t:Total")).toEqual({
      value: "-4.5",
      failureReason: null,
    })
  })

  test("reads a namespaced element through local-name(), which needs no prefix", () => {
    expect(resolveExtractorPath(soapResult, "xpath://*[local-name()=\"Total\"]/text()")).toEqual({ value: "-4.5", failureReason: null })
    expect(resolveExtractorPath(soapResult, "xpath://*[local-name()=\"Place\"]/text()")).toEqual({ value: "Oslo", failureReason: null })
  })

  test("binds a prefix declared inline, which wins over the document's own", () => {
    const path = "xpath[s=http://schemas.xmlsoap.org/soap/envelope/;t=urn:temperature]:/s:Envelope/s:Body/t:GetTemperatureResponse/t:Reading"
    expect(resolveExtractorPath(soapResult, path)).toEqual({ value: ["-6", "-3"], failureReason: null })
  })

  test("returns an attribute's value and a count() number", () => {
    expect(resolveExtractorPath(soapResult, "xpath://*[local-name()=\"Total\"]/@unit")).toEqual({ value: "C", failureReason: null })
    expect(resolveExtractorPath(soapResult, "xpath:count(//*[local-name()=\"Reading\"])")).toEqual({ value: 2, failureReason: null })
  })

  test("is path-missing when nothing matches, invalid-path when the expression is bad", () => {
    expect(resolveExtractorPath(soapResult, "xpath://*[local-name()=\"Nope\"]")).toEqual({ value: undefined, failureReason: "path-missing" })
    expect(resolveExtractorPath(soapResult, "xpath://*[local-name(")).toEqual({ value: undefined, failureReason: "invalid-path" })
    expect(resolveExtractorPath(soapResult, "xpath[s=urn:x]:/s:Envelope")).toEqual({ value: undefined, failureReason: "path-missing" })
  })

  test("is type-mismatch for a JSON body, a truncated body or a DTD", () => {
    const json = { response: { body: { total: 1 } } }
    expect(resolveExtractorPath(json, "xpath://total")).toEqual({ value: undefined, failureReason: "type-mismatch" })
    const dtd = { response: { body: '<!DOCTYPE r [<!ENTITY e "x">]><r>&e;</r>' } }
    expect(resolveExtractorPath(dtd, "xpath:/r")).toEqual({ value: undefined, failureReason: "type-mismatch" })
    expect(resolveExtractorPath(soapResult, 42 as unknown as string)).toEqual({ value: undefined, failureReason: "path-missing" })
  })

  test("does not expand an internal entity, so a billion-laughs bomb is never parsed", () => {
    const bomb = `<!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;">]><lolz>&lol2;</lolz>`
    expect(resolveExtractorPath({ response: { body: bomb } }, "xpath:/lolz")).toEqual({ value: undefined, failureReason: "type-mismatch" })
  })

  test("isXPath and isValidXPath agree with the dispatch", () => {
    expect(isXPath("xpath://a")).toBe(true)
    expect(isXPath("xpath[t=urn:x]:/t:a")).toBe(true)
    expect(isXPath("$..a")).toBe(false)
    expect(isXPath("response.body.a")).toBe(false)
    expect(isValidXPath("xpath://a")).toBe(true)
    expect(isValidXPath("xpath:")).toBe(false)
    expect(isValidXPath("xpath[bad]:/a")).toBe(false)
    expect(isValidXPath("xpath:not-a-path(")).toBe(false)
    expect(isValidXPath("response.body.a")).toBe(false)
  })

  test("keeps the dot and JSONPath grammars intact", () => {
    expect(resolveExtractorPath(soapResult, "response.statusCode")).toEqual({ value: 200, failureReason: null })
    expect(resolveExtractorPath(soapResult, "$.response.statusCode")).toEqual({ value: 200, failureReason: null })
  })
})
