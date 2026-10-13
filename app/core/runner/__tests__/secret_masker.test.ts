import { describe, expect, it } from "vitest"
import { createSecretMasker } from "../secret_masker"

describe("createSecretMasker", () => {
  it("masks every occurrence in nested strings and object keys, leaving other values alone", () => {
    const mask = createSecretMasker(["hunter22"])
    expect(mask({ a: ["x hunter22 y", 3, null, true], hunter22: "hunter22hunter22" })).toEqual({
      a: ["x <SECRET> y", 3, null, true],
      "<SECRET>": "<SECRET><SECRET>",
    })
  })

  it("masks the longest overlapping value whole", () => {
    const mask = createSecretMasker(["abcd", "abcdefgh"])
    expect(mask("abcdefgh abcd")).toBe("<SECRET> <SECRET>")
  })

  it("masks URL-encoded, form-encoded and JSON-escaped forms", () => {
    const mask = createSecretMasker(['p@ss w"rd/1'])
    expect(mask("/u/p%40ss%20w%22rd%2F1")).toBe("/u/<SECRET>")
    expect(mask("pw=p%40ss+w%22rd%2F1")).toBe("pw=<SECRET>")
    expect(mask('{"pw":"p@ss w\\"rd/1"}')).toBe('{"pw":"<SECRET>"}')
  })

  it("masks a Basic credential whose decoded form contains a secret", () => {
    const mask = createSecretMasker(["s3cretpw"])
    const header = `Basic ${Buffer.from("admin:s3cretpw").toString("base64")}`
    expect(mask({ authorization: header })).toEqual({ authorization: "Basic <SECRET>" })
    const unrelated = `Basic ${Buffer.from("admin:other").toString("base64")}`
    expect(mask(unrelated)).toBe(unrelated)
  })

  it("does not mask values shorter than the minimum length", () => {
    const mask = createSecretMasker(["abc", ""])
    expect(mask("abc is everywhere")).toBe("abc is everywhere")
  })
})
