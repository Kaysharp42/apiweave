import { createHmac, generateKeyPairSync, verify } from "node:crypto"
import { describe, expect, it } from "vitest"
import { normalizePem, signJwt } from "../jwt"

const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 })
const ec = generateKeyPairSync("ec", { namedCurve: "prime256v1" })
const pem = (key: { export(options: { type: "pkcs8"; format: "pem" }): string | Buffer }): string => String(key.export({ type: "pkcs8", format: "pem" }))

function parts(jwt: string): { header: unknown; payload: unknown; input: string; signature: Buffer } {
  const [header, payload, signature] = jwt.split(".")
  return {
    header: JSON.parse(Buffer.from(header!, "base64url").toString()),
    payload: JSON.parse(Buffer.from(payload!, "base64url").toString()),
    input: `${header}.${payload}`,
    signature: Buffer.from(signature!, "base64url"),
  }
}

describe("signJwt", () => {
  const payload = { sub: "user-1", iat: 1767323045 }

  it("signs HS256 with the HMAC secret", () => {
    const jwt = signJwt("HS256", "shared-secret", { kid: "k1" }, payload)
    const { header, payload: claims, input, signature } = parts(jwt)
    expect(header).toEqual({ typ: "JWT", kid: "k1", alg: "HS256" })
    expect(claims).toEqual(payload)
    expect(signature.equals(createHmac("sha256", "shared-secret").update(input).digest())).toBe(true)
  })

  it("signs RS256 with an RSA private key, verifiable with its public key", () => {
    const { header, input, signature } = parts(signJwt("RS256", pem(rsa.privateKey), {}, payload))
    expect(header).toEqual({ typ: "JWT", alg: "RS256" })
    expect(verify("sha256", Buffer.from(input), rsa.publicKey, signature)).toBe(true)
  })

  it("signs ES256 with a P-256 key as a raw 64-byte r||s signature", () => {
    const { input, signature } = parts(signJwt("ES256", pem(ec.privateKey), {}, payload))
    expect(signature).toHaveLength(64)
    expect(verify("sha256", Buffer.from(input), { key: ec.publicKey, dsaEncoding: "ieee-p1363" }, signature)).toBe(true)
  })

  it("never lets the header override alg", () => {
    expect(parts(signJwt("HS256", "k", { alg: "none" }, payload)).header).toMatchObject({ alg: "HS256" })
  })

  it("reads a PEM key whose line breaks were lost or escaped", () => {
    const key = pem(ec.privateKey)
    for (const mangled of [key.replace(/\n/g, " "), key.replace(/\n/g, "\\n"), key.replace(/\n/g, "")]) {
      expect(normalizePem(mangled)).toBe(key)
      const { input, signature } = parts(signJwt("ES256", mangled, {}, payload))
      expect(verify("sha256", Buffer.from(input), { key: ec.publicKey, dsaEncoding: "ieee-p1363" }, signature)).toBe(true)
    }
  })

  it("refuses a key that is not PEM, or not the algorithm's kind", () => {
    expect(() => signJwt("RS256", "not a key", {}, payload)).toThrow("JWT: the RS256 signing key is not a PEM private key")
    expect(() => signJwt("RS256", pem(ec.privateKey), {}, payload)).toThrow("JWT: RS256 needs an RSA private key")
    expect(() => signJwt("ES256", pem(rsa.privateKey), {}, payload)).toThrow("JWT: ES256 needs a P-256 EC private key")
  })
})
