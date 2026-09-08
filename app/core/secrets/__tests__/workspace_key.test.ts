import { describe, expect, it } from "vitest"
import { DEK_SIZE, generateDek } from "../crypto"
import {
  DEFAULT_KDF_PARAMS,
  EnvelopeAuthFailed,
  WorkspaceKeyMismatch,
  deriveKek,
  envelopeAad,
  fingerprint,
  openEnvelope,
  sealEnvelope,
  unwrapWdek,
  wrapWdek,
} from "../workspace_key"

const SALT = Buffer.from("00112233445566778899aabbccddeeff", "hex")
/** scrypt at N=2^17 costs ~200 ms; the cheap params exercise the *plumbing* only. */
const CHEAP = { N: 1024, r: 8, p: 1 } as const

describe("deriveKek", () => {
  it("derives a 32-byte key at the real default params (proves maxmem is raised)", () => {
    // The one derivation at N=2^17. Node's default maxmem of 32 MiB throws here
    // unless deriveKek passes maxmem explicitly — this is the regression guard.
    const kek = deriveKek("correct horse battery staple", SALT, DEFAULT_KDF_PARAMS)
    expect(kek.length).toBe(DEK_SIZE)
  })

  it("is deterministic, and changes when passphrase, salt, or params change", () => {
    const hex = (k: Uint8Array): string => Buffer.from(k).toString("hex")
    const base = hex(deriveKek("pass", SALT, CHEAP))

    expect(hex(deriveKek("pass", SALT, CHEAP))).toBe(base)
    expect(hex(deriveKek("pass ", SALT, CHEAP))).not.toBe(base)
    expect(hex(deriveKek("pass", Buffer.alloc(16, 1), CHEAP))).not.toBe(base)
    expect(hex(deriveKek("pass", SALT, { ...CHEAP, N: 2048 }))).not.toBe(base)
    expect(hex(deriveKek("pass", SALT, { ...CHEAP, r: 9 }))).not.toBe(base)
    expect(hex(deriveKek("pass", SALT, { ...CHEAP, p: 2 }))).not.toBe(base)
  })
})

describe("fingerprint", () => {
  it("is 16 lowercase hex chars and differs per key", () => {
    const fp = fingerprint(Buffer.alloc(DEK_SIZE, 7))
    expect(fp).toMatch(/^[0-9a-f]{16}$/)
    expect(fp).not.toBe(fingerprint(Buffer.alloc(DEK_SIZE, 8)))
  })
})

describe("wrapWdek/unwrapWdek", () => {
  it("round-trips a WDEK under a KEK", () => {
    const kek = deriveKek("pass", SALT, CHEAP)
    const wdek = generateDek()
    expect(Buffer.from(unwrapWdek(wrapWdek(wdek, kek), kek)).equals(Buffer.from(wdek))).toBe(true)
  })
})

describe("sealEnvelope/openEnvelope", () => {
  const aad = envelopeAad("cws-1", "workflow", "wf-1")
  const payload = JSON.stringify({ name: "Login flow", nodes: [1, 2, 3] })

  it("round-trips through a JSON envelope of the wire shape", () => {
    const wdek = generateDek()
    const sealed = sealEnvelope(payload, wdek, aad)

    const parsed = JSON.parse(sealed) as Record<string, unknown>
    expect(parsed.e2ee).toBe(1)
    expect(parsed.kid).toBe(fingerprint(wdek))
    expect(Buffer.from(parsed.n as string, "base64").length).toBe(12)
    // The AAD is recomputed by the reader, never carried in the envelope.
    expect(sealed).not.toContain("cws-1")
    expect(sealed).not.toContain("Login flow")

    expect(openEnvelope(sealed, wdek, aad)).toBe(payload)
  })

  it("uses a fresh nonce per seal", () => {
    const wdek = generateDek()
    const a = JSON.parse(sealEnvelope(payload, wdek, aad)) as { n: string }
    const b = JSON.parse(sealEnvelope(payload, wdek, aad)) as { n: string }
    expect(a.n).not.toBe(b.n)
  })

  it("a different WDEK is a key mismatch, not an auth failure", () => {
    const sealed = sealEnvelope(payload, generateDek(), aad)
    expect(() => openEnvelope(sealed, generateDek(), aad)).toThrow(WorkspaceKeyMismatch)
  })

  it("a mismatched AAD is an auth failure, not a key mismatch", () => {
    const wdek = generateDek()
    const sealed = sealEnvelope(payload, wdek, aad)
    // Same key, so the kid check passes — only the GCM tag catches this.
    const wrong = envelopeAad("cws-1", "workflow", "wf-2")
    expect(() => openEnvelope(sealed, wdek, wrong)).toThrow(EnvelopeAuthFailed)
    expect(() => openEnvelope(sealed, wdek, wrong)).not.toThrow(WorkspaceKeyMismatch)
  })

  it("tampered ciphertext is an auth failure", () => {
    const wdek = generateDek()
    const env = JSON.parse(sealEnvelope(payload, wdek, aad)) as { ct: string }
    const ct = Buffer.from(env.ct, "base64")
    ct[0] ^= 0xff
    const tampered = JSON.stringify({ ...env, ct: ct.toString("base64") })
    expect(() => openEnvelope(tampered, wdek, aad)).toThrow(EnvelopeAuthFailed)
  })

  it("non-envelope JSON is rejected as an auth failure", () => {
    const wdek = generateDek()
    expect(() => openEnvelope("not json", wdek, aad)).toThrow(EnvelopeAuthFailed)
    expect(() => openEnvelope(JSON.stringify({ name: "plaintext record" }), wdek, aad)).toThrow(
      EnvelopeAuthFailed,
    )
  })
})
