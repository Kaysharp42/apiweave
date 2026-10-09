import { describe, expect, it } from "vitest"
import { digestAuthorization, parseDigestChallenge } from "../digest_auth"

/** RFC 7616 §3.9.1: the same request answered with SHA-256 and with MD5. */
const RFC_CHALLENGE = (algorithm: string): string =>
  `Digest realm="http-auth@example.org", qop="auth, auth-int", algorithm=${algorithm}, nonce="7ypf/xlj9XXwfDPEoM4URrv/xwf94BcCAzFZH4GiTo0v", opaque="FQhe/qaU925kfnzjCev0ciny7QMkPqMAFRtzCUYo5tdS"`
const RFC_REQUEST = {
  username: "Mufasa",
  password: "Circle of Life",
  method: "GET",
  uri: "/dir/index.html",
  cnonce: "f2/wE4q74E6zIJEtWaHKaf5wv/H5QzzpXusqGemxURZJ",
}

describe("Digest auth (RFC 7616)", () => {
  it.each([
    ["SHA-256", "753927fa0e85d155564e2e272a28d1802ca10daf4496794697cf8db5856cb6c1"],
    ["MD5", "8ca523f5e9506fed4657c9700eebdbec"],
  ])("answers the RFC's %s example", (algorithm, response) => {
    const challenge = parseDigestChallenge(RFC_CHALLENGE(algorithm))!
    expect(challenge).toEqual({
      realm: "http-auth@example.org",
      nonce: "7ypf/xlj9XXwfDPEoM4URrv/xwf94BcCAzFZH4GiTo0v",
      opaque: "FQhe/qaU925kfnzjCev0ciny7QMkPqMAFRtzCUYo5tdS",
      algorithm,
      qop: ["auth", "auth-int"],
    })
    expect(digestAuthorization(challenge, RFC_REQUEST)).toBe(
      `Digest username="Mufasa", realm="http-auth@example.org", nonce="7ypf/xlj9XXwfDPEoM4URrv/xwf94BcCAzFZH4GiTo0v", uri="/dir/index.html", algorithm=${algorithm}, response="${response}", opaque="FQhe/qaU925kfnzjCev0ciny7QMkPqMAFRtzCUYo5tdS", qop=auth, nc=00000001, cnonce="f2/wE4q74E6zIJEtWaHKaf5wv/H5QzzpXusqGemxURZJ"`,
    )
  })

  it("takes the first Digest challenge it supports among several schemes", () => {
    const header = 'Basic realm="x", Digest realm="r", nonce="n1", algorithm=SHA-512-256, Digest realm="r", nonce="n2", algorithm=SHA-256, qop=auth'
    expect(parseDigestChallenge(header)).toMatchObject({ nonce: "n2", algorithm: "SHA-256", qop: ["auth"] })
    expect(parseDigestChallenge('Bearer realm="api"')).toBeNull()
  })

  it("answers an RFC 2069 challenge (no qop) and defaults to MD5", () => {
    const challenge = parseDigestChallenge('Digest realm="r", nonce="abc"')!
    expect(challenge.algorithm).toBe("MD5")
    const header = digestAuthorization(challenge, { username: "u", password: "p", method: "GET", uri: "/" })
    expect(header).not.toContain("qop=")
    expect(header).not.toContain("cnonce=")
  })

  it("refuses a server that offers only auth-int", () => {
    const challenge = parseDigestChallenge('Digest realm="r", nonce="abc", qop="auth-int"')!
    expect(() => digestAuthorization(challenge, { username: "u", password: "p", method: "GET", uri: "/" })).toThrow(
      "Digest auth: the server offers only qop=auth-int, and only qop=auth is supported",
    )
  })
})
