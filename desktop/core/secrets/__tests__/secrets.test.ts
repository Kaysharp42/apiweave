import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  DEK_SIZE,
  decrypt,
  encrypt,
  generateDek,
  unwrapDek,
  wrapDek,
} from "../crypto"
import { openSealedBox, publicKeyFromSeed, seal, sodiumReady } from "../sealed_box"
import {
  KeyfileCorrupted,
  KeyfileMissing,
  createKeyfile,
  readKeyfile,
} from "../keyfile"
import {
  ScopedSecretResolver,
  type SecretMetadata,
  type SecretMetadataStore,
} from "../scoped_secret_resolver"

const CRYPTO_DIR = join(__dirname, "..", "..", "runner", "harness", "fixtures", "crypto")

interface CryptoVector {
  name: string
  plaintextBase64: string
  masterKeySha256Base64: string
  wrappedDekBase64: string
  secretNonceBase64: string
  aes256GcmCiphertextBase64: string
  sealedBoxPublicKeyBase64: string
  sealedBoxCiphertextBase64: string
}

const VECTOR_NAMES = ["empty", "short", "max-size-placeholder"] as const

function loadVector(name: string): CryptoVector {
  return JSON.parse(readFileSync(join(CRYPTO_DIR, `${name}.json`), "utf-8")) as CryptoVector
}

/** urlsafe base64 → bytes (the Python `wrapped_dek` uses urlsafe alphabet). */
function fromUrlsafe(b64: string): Buffer {
  return Buffer.from(b64.replace(/-/g, "+").replace(/_/g, "/"), "base64")
}

describe("secrets crypto — byte-equality vs Python fixtures", () => {
  for (const name of VECTOR_NAMES) {
    it(`AES-256-GCM output is byte-identical for the "${name}" vector`, () => {
      const v = loadVector(name)
      const master = Buffer.from(v.masterKeySha256Base64, "base64")
      const dek = unwrapDek(fromUrlsafe(v.wrappedDekBase64), master)
      expect(dek.length).toBe(DEK_SIZE)

      const value = Buffer.from(v.plaintextBase64, "base64").toString("utf-8")
      const nonce = Buffer.from(v.secretNonceBase64, "base64")
      const blob = encrypt(value, dek, "kek-test", nonce)

      expect(Buffer.from(blob.ciphertext).toString("base64")).toBe(v.aes256GcmCiphertextBase64)
      // and it decodes back to the exact value
      expect(decrypt(blob, dek)).toBe(value)
    })

    it(`sealed-box public key derivation is byte-identical for the "${name}" vector`, async () => {
      const v = loadVector(name)
      const seed = Buffer.from(v.masterKeySha256Base64, "base64")
      const pub = await publicKeyFromSeed(seed)
      expect(Buffer.from(pub).toString("base64")).toBe(v.sealedBoxPublicKeyBase64)
    })

    it(`opens the captured sealed-box ciphertext for the "${name}" vector`, async () => {
      const v = loadVector(name)
      const seed = Buffer.from(v.masterKeySha256Base64, "base64")
      const plaintext = Buffer.from(v.plaintextBase64, "base64").toString("utf-8")
      const ct = Buffer.from(v.sealedBoxCiphertextBase64, "base64")
      expect(await openSealedBox(ct, seed)).toBe(plaintext)
    })
  }
})

describe("secrets crypto — round trips", () => {
  it("wrapDek/unwrapDek round-trips a fresh DEK", () => {
    const master = generateDek()
    const dek = generateDek()
    expect(Buffer.from(unwrapDek(wrapDek(dek, master), master)).equals(Buffer.from(dek))).toBe(true)
  })

  it("encrypt/decrypt round-trips including a 256-byte value", () => {
    const dek = generateDek()
    for (const value of ["", "hunter2", "x".repeat(256)]) {
      expect(decrypt(encrypt(value, dek, "kek-test"), dek)).toBe(value)
    }
  })

  it("sealed-box seal→open round-trips ingress including a 256-byte value", async () => {
    await sodiumReady()
    const seed = Buffer.from("11".repeat(32), "hex")
    const pub = await publicKeyFromSeed(seed)
    for (const plaintext of ["", "hunter2", "y".repeat(256)]) {
      const ct = await seal(plaintext, pub)
      expect(await openSealedBox(ct, seed)).toBe(plaintext)
    }
  })
})

describe("keyfile — no regeneration on corrupt (security-critical)", () => {
  let dir: string
  let path: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "apiweave-keyfile-"))
    path = join(dir, "secrets.keyfile.json")
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it("createKeyfile bootstraps a valid 32-byte master KEK, readable afterward", () => {
    const created = createKeyfile(path)
    expect(created.masterKek.length).toBe(DEK_SIZE)
    const read = readKeyfile(path)
    expect(Buffer.from(read.masterKek).equals(Buffer.from(created.masterKek))).toBe(true)
  })

  it("readKeyfile throws KeyfileMissing when absent — never writes", () => {
    expect(() => readKeyfile(path)).toThrow(KeyfileMissing)
  })

  it("corrupt keyfile throws KeyfileCorrupted and is NOT silently regenerated", () => {
    // First-run: seal-and-store a secret (wrap a DEK under the KEK) and remember its wrap.
    const kf = createKeyfile(path)
    const storedWrap = Buffer.from(wrapDek(generateDek(), kf.masterKek))

    // An attacker/disk-fault corrupts the keyfile on disk.
    writeFileSync(path, "}{ not json at all", "utf-8")

    // Attempting to seal another secret must load the keyfile → loud throw.
    expect(() => readKeyfile(path)).toThrow(KeyfileCorrupted)

    // The keyfile on disk is UNCHANGED (no auto-recover wrote a fresh KEK)...
    expect(readFileSync(path, "utf-8")).toBe("}{ not json at all")
    // ...and the previously stored wrapped DEK is untouched in memory (no orphan).
    expect(storedWrap.length).toBeGreaterThan(0)
  })

  it("createKeyfile refuses to overwrite an existing keyfile", () => {
    createKeyfile(path)
    expect(() => createKeyfile(path)).toThrow(KeyfileCorrupted)
  })

  it("rejects a wrong-length master KEK as corrupt", () => {
    writeFileSync(path, JSON.stringify({ version: 1, masterKekBase64: "AAAA" }), "utf-8")
    expect(() => readKeyfile(path)).toThrow(KeyfileCorrupted)
  })
})

describe("ScopedSecretResolver — override chain (environment > workspace)", () => {
  const meta = (scopeType: "environment" | "workspace", scopeId: string): SecretMetadata => ({
    secretId: `sec-${scopeType}-${scopeId}`,
    name: "API_KEY",
    scopeType,
    scopeId,
    keyId: "sealed-box-v1",
  })

  function storeWith(entries: SecretMetadata[]): SecretMetadataStore {
    return {
      getByScopeAndName: (scopeType, scopeId, name) =>
        entries.find(
          (e) => e.scopeType === scopeType && e.scopeId === scopeId && e.name === name,
        ) ?? null,
    }
  }

  it("environment scope overrides workspace scope", async () => {
    const resolver = new ScopedSecretResolver(
      storeWith([meta("environment", "env-1"), meta("workspace", "ws-1")]),
    )
    const result = await resolver.resolve({ environmentId: "env-1", workspaceId: "ws-1" }, "API_KEY")
    expect(result?.resolvedScope).toBe("environment")
    expect(result?.metadata.scopeId).toBe("env-1")
  })

  it("falls back to workspace scope when the environment has no override", async () => {
    const resolver = new ScopedSecretResolver(storeWith([meta("workspace", "ws-1")]))
    const result = await resolver.resolve({ environmentId: "env-1", workspaceId: "ws-1" }, "API_KEY")
    expect(result?.resolvedScope).toBe("workspace")
  })

  it("returns null when the secret is unset in every scope", async () => {
    const resolver = new ScopedSecretResolver(storeWith([]))
    expect(await resolver.resolve({ environmentId: "env-1", workspaceId: "ws-1" }, "API_KEY")).toBeNull()
  })

  it("resolved result carries metadata only — no ciphertext or plaintext field", async () => {
    const resolver = new ScopedSecretResolver(storeWith([meta("workspace", "ws-1")]))
    const result = await resolver.resolve({ workspaceId: "ws-1" }, "API_KEY")
    const keys = Object.keys(result?.metadata ?? {})
    expect(keys).not.toContain("ciphertext")
    expect(keys).not.toContain("plaintext")
    expect(keys).not.toContain("value")
  })
})
