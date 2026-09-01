/**
 * Workspace encryption bundles — the passphrase half of E2EE cloud sync.
 *
 * A bundle is exactly what the server stores and hands back: the WDEK wrapped
 * under a passphrase-derived KEK, the KDF salt and cost parameters used to
 * derive it, and the WDEK's fingerprint. It is safe to persist locally — it is
 * useless without the passphrase — which is what lets a provisioning decision
 * survive a crash between "user chose a passphrase" and "the workspace row was
 * created in the cloud".
 */

import { randomBytes } from "node:crypto"
import { create } from "@bufbuild/protobuf"
import {
  WorkspaceEncryptionMode as WireEncryptionMode,
  WorkspaceEncryptionSchema,
  type WorkspaceEncryption,
} from "@apiweave/proto/apiweave/v1/device_pb"
import {
  DEFAULT_KDF_PARAMS,
  deriveKek,
  fingerprint,
  unwrapWdek,
  wrapWdek,
  type KdfParams,
} from "../../core/secrets/workspace_key"
import { generateDek, DEK_SIZE, NONCE_SIZE, TAG_SIZE } from "../../core/secrets/crypto"
import {
  CloudWorkspaceEncryptionInvalidError,
  CloudWorkspacePassphraseIncorrectError,
  type WorkspaceEncryptionMode,
} from "../../core/services/cloud_sync_control"

export type { WorkspaceEncryptionMode }

/**
 * A `WorkspaceEncryption` with its bytes as base64.
 *
 * NOT the generated message: a pending bundle is `JSON.stringify`d into
 * app_settings before provisioning, and a `Uint8Array` does not survive that
 * round trip — it comes back as `{"0":..}`. Base64 in, bytes only at the wire.
 */
export interface WorkspaceEncryptionBundle {
  /** nonce(12) || ct(32) || tag(16) = 60 bytes, base64. */
  readonly wrappedWdek: string
  /** 16..64 bytes, base64. */
  readonly kdfSalt: string
  /** JSON, e.g. `{"N":131072,"r":8,"p":1}`. Round-trips through JSONB: parse it, never string-compare. */
  readonly kdfParams: string
  /** Lowercase hex, exactly 16 chars. */
  readonly wdekFingerprint: string
}

/** A `GetWorkspaceEncryption` / `SetWorkspacePassphrase` response. */
export interface WorkspaceEncryptionRecord extends WorkspaceEncryptionBundle {
  readonly mode: WorkspaceEncryptionMode
}

/**
 * Salt size for new workspaces: 32 bytes. The server accepts 16..64; 32 matches
 * the KEK and WDEK width and leaves headroom at both ends of the range.
 */
export const KDF_SALT_SIZE = 32

const WRAPPED_WDEK_SIZE = NONCE_SIZE + DEK_SIZE + TAG_SIZE // 60
const MIN_SALT_SIZE = 16
const MAX_SALT_SIZE = 64
/** Matches `SCRYPT_MAXMEM` in `core/secrets/workspace_key.ts`. */
const MAX_SCRYPT_MEMORY = 256 * 1024 * 1024

/**
 * Map the wire enum onto the string union that crosses IPC and is persisted in
 * the local catalog. Anything this client does not know — including the zero
 * value an older server leaves — is `unspecified`, never `none`.
 */
export function encryptionModeOf(mode: WireEncryptionMode): WorkspaceEncryptionMode {
  switch (mode) {
    case WireEncryptionMode.NONE:
      return "none"
    case WireEncryptionMode.E2EE:
      return "e2ee"
    default:
      return "unspecified"
  }
}

/** Decoded response → the base64 shape the key math and local storage speak. */
export function toEncryptionRecord(message: WorkspaceEncryption): WorkspaceEncryptionRecord {
  return {
    mode: encryptionModeOf(message.mode),
    wrappedWdek: Buffer.from(message.wrappedWdek).toString("base64"),
    kdfSalt: Buffer.from(message.kdfSalt).toString("base64"),
    kdfParams: message.kdfParams,
    wdekFingerprint: message.wdekFingerprint,
  }
}

/** The `encryption` field of a provisioning request. */
export function toEncryptionMessage(bundle: WorkspaceEncryptionBundle): WorkspaceEncryption {
  return create(WorkspaceEncryptionSchema, {
    mode: WireEncryptionMode.E2EE,
    wrappedWdek: decodeBytes(bundle.wrappedWdek, "wrapped key"),
    kdfSalt: decodeBytes(bundle.kdfSalt, "salt"),
    kdfParams: bundle.kdfParams,
    wdekFingerprint: bundle.wdekFingerprint,
  })
}

/**
 * Mint a fresh workspace key from `passphrase`. Returns the bundle to send and
 * the WDEK to cache — the caller owns both; nothing is stored here.
 *
 * Derive ONCE per provisioning attempt and reuse the result: the server keys
 * `CreateSyncWorkspace` retries on `request_id` and rejects a retry whose
 * bundle differs by a byte, and the salt and WDEK here are random.
 */
export function createEncryptionBundle(passphrase: string): {
  readonly bundle: WorkspaceEncryptionBundle
  readonly wdek: Uint8Array
} {
  requirePassphrase(passphrase)
  const wdek = generateDek()
  return { bundle: rewrapBundle(wdek, passphrase), wdek }
}

/** Wrap an existing WDEK under a new passphrase — a passphrase change keeps the key (and its fingerprint). */
export function rewrapBundle(wdek: Uint8Array, passphrase: string): WorkspaceEncryptionBundle {
  requirePassphrase(passphrase)
  const salt = randomBytes(KDF_SALT_SIZE)
  const kek = deriveKek(passphrase, salt, DEFAULT_KDF_PARAMS)
  return {
    wrappedWdek: Buffer.from(wrapWdek(wdek, kek)).toString("base64"),
    kdfSalt: Buffer.from(salt).toString("base64"),
    kdfParams: JSON.stringify(DEFAULT_KDF_PARAMS),
    wdekFingerprint: fingerprint(wdek),
  }
}

/**
 * Recover the WDEK from a bundle the server stored.
 *
 * Uses the bundle's OWN salt and params, never {@link DEFAULT_KDF_PARAMS} —
 * those are only for new workspaces, and reading them here would strand every
 * workspace derived under an older work factor. The fingerprint is checked
 * before the key is returned, so a key that unwraps but is not the one this
 * workspace's data was sealed with is rejected here rather than surfacing later
 * as an unreadable record.
 */
export function openEncryptionBundle(bundle: WorkspaceEncryptionBundle, passphrase: string): Uint8Array {
  requirePassphrase(passphrase)
  const wrapped = decodeBytes(bundle.wrappedWdek, "wrapped key")
  if (wrapped.length !== WRAPPED_WDEK_SIZE) {
    throw new CloudWorkspaceEncryptionInvalidError(`wrapped key is ${wrapped.length} bytes, expected ${WRAPPED_WDEK_SIZE}`)
  }
  const salt = decodeBytes(bundle.kdfSalt, "salt")
  if (salt.length < MIN_SALT_SIZE || salt.length > MAX_SALT_SIZE) {
    throw new CloudWorkspaceEncryptionInvalidError(`salt is ${salt.length} bytes, expected ${MIN_SALT_SIZE}..${MAX_SALT_SIZE}`)
  }
  if (!/^[0-9a-f]{16}$/.test(bundle.wdekFingerprint)) {
    throw new CloudWorkspaceEncryptionInvalidError("key fingerprint is not 16 hex characters")
  }

  const kek = deriveKek(passphrase, salt, parseKdfParams(bundle.kdfParams))
  let wdek: Uint8Array
  try {
    wdek = unwrapWdek(wrapped, kek)
  } catch {
    throw new CloudWorkspacePassphraseIncorrectError()
  }
  if (fingerprint(wdek) !== bundle.wdekFingerprint) {
    throw new CloudWorkspacePassphraseIncorrectError()
  }
  return wdek
}

/**
 * Parse server-stored scrypt parameters. Bounded because they are attacker-
 * influenced input to a memory-hard function: an unbounded `N` is a
 * self-inflicted OOM on the machine typing the passphrase.
 */
export function parseKdfParams(json: string): KdfParams {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    throw new CloudWorkspaceEncryptionInvalidError("KDF parameters are not valid JSON")
  }
  const params = (typeof parsed === "object" && parsed !== null ? parsed : {}) as Record<string, unknown>
  const N = params["N"]
  const r = params["r"]
  const p = params["p"]
  if (!isPositiveInt(N) || !isPositiveInt(r) || !isPositiveInt(p)) {
    throw new CloudWorkspaceEncryptionInvalidError("KDF parameters must be positive integers N, r, p")
  }
  if ((N & (N - 1)) !== 0) {
    throw new CloudWorkspaceEncryptionInvalidError("KDF parameter N must be a power of two")
  }
  // scrypt's own bound is 128 * r * (N + p + 2) — checking `128 * N * r` lets a
  // record sitting exactly on the limit through and then throws a raw Error out
  // of scryptSync instead of an invalid-params one.
  if (128 * r * (N + p + 2) > MAX_SCRYPT_MEMORY || p > 16) {
    throw new CloudWorkspaceEncryptionInvalidError("KDF parameters exceed the supported work factor")
  }
  return { N, r, p }
}

function isPositiveInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0
}

function decodeBytes(base64: string, label: string): Uint8Array {
  const decoded = Buffer.from(base64, "base64")
  // Buffer.from silently truncates at the first invalid character, so a
  // mangled field would otherwise decode to a plausible-looking short buffer.
  if (base64.length === 0 || decoded.toString("base64").replace(/=+$/, "") !== base64.replace(/=+$/, "")) {
    throw new CloudWorkspaceEncryptionInvalidError(`${label} is not valid base64`)
  }
  return decoded
}

function requirePassphrase(passphrase: string): void {
  if (typeof passphrase !== "string" || passphrase.length === 0) {
    throw new Error("A passphrase is required to encrypt this workspace")
  }
}
