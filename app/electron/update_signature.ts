import { createHash, createPublicKey, verify } from "node:crypto"
import { createReadStream } from "node:fs"
import { basename } from "node:path"
import { UPDATE_SIGNING_PUBLIC_KEY } from "./update_signing_key"

// ---------------------------------------------------------------------------
// Update signatures
//
// OS code signing is optional and depends on the release secrets, so this is
// still the layer that keeps a compromised release account from shipping code
// to every install: without it the only thing standing between a GitHub release
// and every installed client is a sha512 that arrives in the same release as
// the installer it vouches for.
//
// The release workflow signs each electron-updater manifest with an Ed25519
// key held as a GitHub Actions secret (scripts/sign-update-manifest.mjs), and
// this file verifies the signature against the public key compiled into the
// app. The signature covers the version and the sha512 of the installer, and
// is checked against the bytes actually downloaded — so a swapped installer, a
// tampered blockmap, or an old signed installer relabelled as a newer version
// all fail. The rollout workflow rewrites `stagingPercentage` in the same
// manifests; that field is deliberately not signed, so staging needs no key.
//
// A manifest describing more than one installer (the macOS x64 and arm64 zips)
// carries one signature per file under `apiweaveSignatures`, keyed by the
// artifact filename. The top-level `apiweaveSignature` stays for clients that
// predate the map and covers the manifest's primary `path`; a client that finds
// the map uses the entry for the file it actually downloaded, and refuses a
// file the map does not name.
// ---------------------------------------------------------------------------

/** The top-level manifest field the signature travels in. Written by
 * scripts/sign-update-manifest.mjs — keep the two in step. */
export const UPDATE_SIGNATURE_FIELD = "apiweaveSignature"

/** Per-file signatures for manifests that list more than one installer. */
export const UPDATE_FILE_SIGNATURES_FIELD = "apiweaveSignatures"

/** What update_signing_key.ts holds until someone generates a real key. */
export const UPDATE_SIGNING_KEY_PLACEHOLDER = "PLACEHOLDER"

/** The exact bytes CI signs. scripts/sign-update-manifest.mjs builds the same
 * string; the round-trip test runs that script against this verifier. */
function signedPayload(version: string, sha512: string): Buffer {
  return Buffer.from(`apiweave-update/1\n${version}\n${sha512}\n`, "utf8")
}

async function sha512Base64(file: string): Promise<string> {
  const hash = createHash("sha512")
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest("base64")
}

/**
 * The signature that covers `file`: the per-file entry when the manifest
 * carries the map, otherwise the legacy top-level signature. A map that does
 * not name this file is a refusal, not a reason to fall back to a signature
 * for some other artifact.
 */
function signatureFor(
  file: string,
  signature: unknown,
  fileSignatures: unknown,
  version: string,
): { signature: unknown; failure: string | null } {
  if (fileSignatures === undefined || fileSignatures === null) return { signature, failure: null }
  if (typeof fileSignatures !== "object" || Array.isArray(fileSignatures)) {
    return {
      signature: null,
      failure: "The update manifest's per-file signatures are malformed, so the update will not be installed.",
    }
  }

  const name = basename(file)
  const entries = fileSignatures as Record<string, unknown>
  if (!Object.prototype.hasOwnProperty.call(entries, name)) {
    return {
      signature: null,
      failure: `The update to ${version} has no signature for ${name}, so it will not be installed.`,
    }
  }
  return { signature: entries[name], failure: null }
}

/**
 * Checks a downloaded update against the signature from its manifest.
 * Resolves `null` when it verifies, otherwise the reason it must not be
 * installed — a sentence fit for the Updates panel.
 *
 * `fileSignatures` is the manifest's `apiweaveSignatures` map when it has one;
 * it selects the signature for this exact downloaded file. `publicKey` is the
 * base64 SPKI DER form update_signing_key.ts holds; it is a parameter only so
 * tests can use a throwaway key.
 */
export async function verifyUpdateFile(
  file: string,
  version: string,
  signature: unknown,
  fileSignatures?: unknown,
  publicKey: string = UPDATE_SIGNING_PUBLIC_KEY,
): Promise<string | null> {
  if (publicKey === UPDATE_SIGNING_KEY_PLACEHOLDER) {
    return "This build has no update signing key, so it cannot verify updates and will not install them. Download the new version from the release page."
  }

  const selected = signatureFor(file, signature, fileSignatures, version)
  if (selected.failure !== null) return selected.failure
  if (typeof selected.signature !== "string" || selected.signature === "") {
    return `The update to ${version} is not signed, so it will not be installed.`
  }

  let valid: boolean
  try {
    const key = createPublicKey({ key: Buffer.from(publicKey, "base64"), format: "der", type: "spki" })
    valid = verify(
      null,
      signedPayload(version, await sha512Base64(file)),
      key,
      Buffer.from(selected.signature, "base64"),
    )
  } catch {
    valid = false
  }
  return valid ? null : `The update to ${version} failed its signature check, so it will not be installed.`
}
