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
// Signing hashes every installer the manifest's `files:` list names (resolved
// beside the manifest) and appends `apiweaveSignature: <base64>` for the
// primary `path` plus an `apiweaveSignatures` map keyed by filename, replacing
// any earlier values, so a re-run is safe. A single-installer manifest gets
// one entry in the map; the macOS manifest gets one per architecture. The
// signed bytes must stay identical to signedPayload() in
// electron/update_signature.ts; update_signature.test.ts runs this script
// against that verifier.
import { createHash, createPrivateKey, createPublicKey, sign } from "node:crypto"
import { createReadStream, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const SIGNATURE_FIELD = "apiweaveSignature"
const FILE_SIGNATURES_FIELD = "apiweaveSignatures"
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

/** Every installer a manifest's `files:` list names. electron-builder writes
 * flat `- url: ...` entries at two-space indent; the sha512 on the following
 * line is deliberately ignored because this script hashes the actual file. */
function fileUrls(text) {
  const urls = []
  for (const match of text.matchAll(/^[ \t]+-[ \t]+url:[ \t]*['"]?([^'"\n]+?)['"]?[ \t]*$/gm)) {
    const url = match[1].trim()
    if (url !== "" && !urls.includes(url)) urls.push(url)
  }
  return urls
}

/** Removes this script's previous fields, so a retried job replaces them
 * instead of stacking a second copy (or leaving a stale arch behind). */
function stripSignatures(text) {
  const kept = []
  let inMap = false
  for (const line of text.split("\n")) {
    if (line.startsWith(`${SIGNATURE_FIELD}:`)) continue
    if (line.startsWith(`${FILE_SIGNATURES_FIELD}:`)) {
      inMap = true
      continue
    }
    if (inMap) {
      if (line.trim() === "" || /^[ \t]/.test(line)) continue
      inMap = false
    }
    kept.push(line)
  }
  return kept.join("\n").replace(/\n*$/, "\n")
}

async function sha512Base64(file) {
  const hash = createHash("sha512")
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest("base64")
}

async function signatureFor(manifest, key, version, installer) {
  const digest = await sha512Base64(path.join(path.dirname(manifest), installer))
  return sign(null, Buffer.from(`apiweave-update/1\n${version}\n${digest}\n`, "utf8"), key).toString("base64")
}

async function signManifest(manifest, key) {
  const text = readFileSync(manifest, "utf8")
  const version = topScalar(text, "version")
  const installer = topScalar(text, "path")
  if (!version || !installer) fail(`${manifest} has no top-level version or path`)

  const urls = fileUrls(text)
  if (!urls.includes(installer)) urls.unshift(installer)

  const signatures = new Map()
  for (const url of urls) signatures.set(url, await signatureFor(manifest, key, version, url))

  let output = stripSignatures(text)
  output += `${SIGNATURE_FIELD}: ${signatures.get(installer)}\n`
  output += `${FILE_SIGNATURES_FIELD}:\n`
  for (const [url, signature] of signatures) output += `  ${JSON.stringify(url)}: ${signature}\n`
  writeFileSync(manifest, output)
  console.log(`${manifest}: signed ${urls.length} file(s) for v${version}: ${urls.join(", ")}`)
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
