#!/usr/bin/env node
// Signs electron-updater manifests for the release workflow, and checks that
// the signing secret is the key the app embeds. See
// docs/reference/release-and-updates.md.
//
//   node scripts/sign-update-manifest.mjs --check
//   node scripts/sign-update-manifest.mjs <dir>/latest.yml [<dir>/latest-linux.yml ...]
//
// Both read the Ed25519 private key (PEM) from UPDATE_SIGNING_PRIVATE_KEY and
// fail loudly without it: a release is never published unsigned.
//
// Signing hashes the installer the manifest's `path` names (resolved beside the
// manifest) and appends `apiweaveSignature: <base64>`, replacing any earlier
// one, so a re-run is safe. The signed bytes must stay identical to
// signedPayload() in electron/update_signature.ts; update_signature.test.ts
// runs this script against that verifier.
import { createHash, createPrivateKey, createPublicKey, sign } from "node:crypto"
import { createReadStream, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const SIGNATURE_FIELD = "apiweaveSignature"
const KEY_FILE = fileURLToPath(new URL("../electron/update_signing_key.ts", import.meta.url))

function fail(message) {
  console.error(`::error::${message}`)
  process.exit(1)
}

function privateKey() {
  const pem = process.env.UPDATE_SIGNING_PRIVATE_KEY?.trim()
  if (!pem) {
    fail(
      "UPDATE_SIGNING_PRIVATE_KEY is not set. Update manifests must be signed; " +
        "generate a key with app/scripts/generate-update-signing-key.mjs and add it as a repository secret.",
    )
  }
  try {
    const key = createPrivateKey(pem)
    if (key.asymmetricKeyType === "ed25519") return key
  } catch {
    // Reported below, without echoing anything about the secret's contents.
  }
  fail("UPDATE_SIGNING_PRIVATE_KEY is not an Ed25519 private key in PEM form.")
}

function check(key) {
  const embedded = /UPDATE_SIGNING_PUBLIC_KEY: string = "([^"]*)"/.exec(readFileSync(KEY_FILE, "utf8"))?.[1]
  const derived = createPublicKey(key).export({ format: "der", type: "spki" }).toString("base64")
  if (embedded !== derived) {
    fail(
      `UPDATE_SIGNING_PRIVATE_KEY does not match the public key in app/electron/update_signing_key.ts ` +
        `(${embedded === "PLACEHOLDER" ? "still the placeholder" : "a different key"}). ` +
        "Installs built from this commit would refuse every update signed with it.",
    )
  }
  console.log("Update signing key matches the public key this build embeds.")
}

/** A top-level `name: value` scalar. electron-builder writes these flat; the
 * per-file entries under `files:` are indented and never match. */
function topScalar(text, name) {
  return new RegExp(`^${name}:[ \\t]*['"]?([^'"\\n]*?)['"]?[ \\t]*$`, "m").exec(text)?.[1]
}

async function sha512Base64(file) {
  const hash = createHash("sha512")
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest("base64")
}

async function signManifest(manifest, key) {
  const text = readFileSync(manifest, "utf8")
  const version = topScalar(text, "version")
  const installer = topScalar(text, "path")
  if (!version || !installer) fail(`${manifest} has no top-level version or path`)

  const digest = await sha512Base64(path.join(path.dirname(manifest), installer))
  const payload = Buffer.from(`apiweave-update/1\n${version}\n${digest}\n`, "utf8")
  const signature = sign(null, payload, key).toString("base64")

  const kept = text
    .split("\n")
    .filter((line) => !line.startsWith(`${SIGNATURE_FIELD}:`))
    .join("\n")
    .replace(/\n*$/, "\n")
  writeFileSync(manifest, `${kept}${SIGNATURE_FIELD}: ${signature}\n`)
  console.log(`${manifest}: signed ${installer} (v${version})`)
}

const args = process.argv.slice(2)
const key = privateKey()
if (args[0] === "--check") {
  check(key)
} else if (args.length === 0) {
  fail("usage: sign-update-manifest.mjs --check | <manifest.yml>...")
} else {
  for (const manifest of args) await signManifest(manifest, key)
}
