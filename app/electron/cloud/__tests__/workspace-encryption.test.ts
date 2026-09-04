import { describe, expect, it } from "vitest"
import { create } from "@bufbuild/protobuf"
import {
  WorkspaceEncryptionMode as WireEncryptionMode,
  WorkspaceEncryptionSchema,
} from "@apiweave/proto/apiweave/v1/device_pb"
import {
  createEncryptionBundle,
  encryptionModeOf,
  openEncryptionBundle,
  parseKdfParams,
  rewrapBundle,
  toEncryptionMessage,
  toEncryptionRecord,
  KDF_SALT_SIZE,
} from "../workspace-encryption"
import {
  CloudWorkspaceEncryptionInvalidError,
  CloudWorkspacePassphraseIncorrectError,
} from "../../../core/services/cloud_sync_control"
import { fingerprint } from "../../../core/secrets/workspace_key"

const PASSPHRASE = "correct horse battery staple"

// One derivation is ~200ms at N=2^17, so the whole-bundle cases share this one.
const provisioned = createEncryptionBundle(PASSPHRASE)

describe("workspace encryption bundles", () => {
  it("produces a bundle the server's validation rules accept", () => {
    const { bundle } = provisioned
    // nonce(12) || ct(32) || tag(16) — the server requires exactly 60 bytes.
    expect(Buffer.from(bundle.wrappedWdek, "base64")).toHaveLength(60)
    const salt = Buffer.from(bundle.kdfSalt, "base64")
    expect(salt).toHaveLength(KDF_SALT_SIZE)
    expect(salt.length).toBeGreaterThanOrEqual(16)
    expect(salt.length).toBeLessThanOrEqual(64)
    expect(bundle.wdekFingerprint).toMatch(/^[0-9a-f]{16}$/)
    // kdf_params round-trips through JSONB, so it must survive a parse rather
    // than a string comparison.
    expect(parseKdfParams(bundle.kdfParams)).toEqual({ N: 131072, r: 8, p: 1 })
  })

  it("names the key it actually wrapped", () => {
    expect(provisioned.bundle.wdekFingerprint).toBe(fingerprint(provisioned.wdek))
    expect(provisioned.wdek).toHaveLength(32)
  })

  it("recovers the same key from the right passphrase", () => {
    expect(Buffer.from(openEncryptionBundle(provisioned.bundle, PASSPHRASE)))
      .toEqual(Buffer.from(provisioned.wdek))
  })

  it("reports a wrong passphrase as a wrong passphrase, not a GCM failure", () => {
    expect(() => openEncryptionBundle(provisioned.bundle, "wrong passphrase"))
      .toThrow(CloudWorkspacePassphraseIncorrectError)
  })

  it("rejects a key that unwraps but is not the one the server names", () => {
    // A tampered fingerprint stands in for "this unwrapped to some other key":
    // the check must happen before the key is handed back.
    expect(() => openEncryptionBundle(
      { ...provisioned.bundle, wdekFingerprint: "0123456789abcdef" },
      PASSPHRASE,
    )).toThrow(CloudWorkspacePassphraseIncorrectError)
  })

  it("derives with the server's stored parameters, not the current defaults", () => {
    // A workspace minted under a weaker work factor must stay openable.
    const legacyParams = { N: 16384, r: 8, p: 1 }
    const legacy = { ...provisioned.bundle, kdfParams: JSON.stringify(legacyParams) }
    // Same salt, different N: the derived KEK differs, so it must NOT open —
    // proving the params are read from the bundle rather than hardcoded.
    expect(() => openEncryptionBundle(legacy, PASSPHRASE))
      .toThrow(CloudWorkspacePassphraseIncorrectError)
  })

  it("keeps the same key (and fingerprint) across a passphrase change", () => {
    const rewrapped = rewrapBundle(provisioned.wdek, "a different passphrase")
    expect(rewrapped.wdekFingerprint).toBe(provisioned.bundle.wdekFingerprint)
    expect(rewrapped.kdfSalt).not.toBe(provisioned.bundle.kdfSalt)
    expect(Buffer.from(openEncryptionBundle(rewrapped, "a different passphrase")))
      .toEqual(Buffer.from(provisioned.wdek))
  })

  it("refuses malformed server records instead of guessing", () => {
    const cases: Record<string, unknown> = {
      "short wrapped key": { ...provisioned.bundle, wrappedWdek: Buffer.alloc(32).toString("base64") },
      "short salt": { ...provisioned.bundle, kdfSalt: Buffer.alloc(8).toString("base64") },
      "bad fingerprint": { ...provisioned.bundle, wdekFingerprint: "not-hex" },
      "bad params": { ...provisioned.bundle, kdfParams: "{" },
    }
    for (const [label, bundle] of Object.entries(cases)) {
      expect(() => openEncryptionBundle(bundle as never, PASSPHRASE), label)
        .toThrow(CloudWorkspaceEncryptionInvalidError)
    }
  })

  it("bounds the work factor so a hostile record cannot OOM the client", () => {
    expect(() => parseKdfParams(JSON.stringify({ N: 2 ** 26, r: 8, p: 1 })))
      .toThrow(CloudWorkspaceEncryptionInvalidError)
    expect(() => parseKdfParams(JSON.stringify({ N: 100000, r: 8, p: 1 })))
      .toThrow(/power of two/)
    expect(() => parseKdfParams(JSON.stringify({ N: 16384, r: 0, p: 1 })))
      .toThrow(/positive integers/)
    // Exactly on the limit for `128 * N * r`, over it for what scrypt enforces.
    expect(() => parseKdfParams(JSON.stringify({ N: 262144, r: 8, p: 1 })))
      .toThrow(CloudWorkspaceEncryptionInvalidError)
  })
})

describe("wire ↔ bundle conversion", () => {
  it("maps the wire enum, reading anything unknown as unspecified and never as none", () => {
    expect(encryptionModeOf(WireEncryptionMode.E2EE)).toBe("e2ee")
    expect(encryptionModeOf(WireEncryptionMode.NONE)).toBe("none")
    // An older server leaves the zero value. Reading that as plaintext would
    // push readable records into an encrypted workspace.
    expect(encryptionModeOf(WireEncryptionMode.UNSPECIFIED)).toBe("unspecified")
    expect(encryptionModeOf(99 as WireEncryptionMode)).toBe("unspecified")
  })

  it("round-trips the bundle's base64 through the message's bytes fields", () => {
    const bundle = {
      wrappedWdek: "AAECAw==",
      kdfSalt: "BAUGBw==",
      kdfParams: '{"N":16384,"r":8,"p":1}',
      wdekFingerprint: "0123456789abcdef",
    }
    const message = toEncryptionMessage(bundle)
    expect(message.mode).toBe(WireEncryptionMode.E2EE)
    expect(Array.from(message.wrappedWdek)).toEqual([0, 1, 2, 3])
    expect(Array.from(message.kdfSalt)).toEqual([4, 5, 6, 7])
    expect(toEncryptionRecord(message)).toEqual({ mode: "e2ee", ...bundle })
  })

  it("reads a plaintext workspace's empty record", () => {
    expect(toEncryptionRecord(create(WorkspaceEncryptionSchema, { mode: WireEncryptionMode.NONE })))
      .toEqual({ mode: "none", wrappedWdek: "", kdfSalt: "", kdfParams: "", wdekFingerprint: "" })
  })
})
