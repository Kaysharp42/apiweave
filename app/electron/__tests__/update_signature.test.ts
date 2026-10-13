import { execFileSync, spawnSync } from "node:child_process"
import { createHash, generateKeyPairSync, sign } from "node:crypto"
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { UPDATE_SIGNATURE_FIELD, UPDATE_SIGNING_KEY_PLACEHOLDER, verifyUpdateFile } from "../update_signature"

const APP_DIR = path.resolve(__dirname, "../..")
const SIGN_SCRIPT = path.join(APP_DIR, "scripts/sign-update-manifest.mjs")
const GENERATE_SCRIPT = path.join(APP_DIR, "scripts/generate-update-signing-key.mjs")

/** A throwaway key pair — never the project's. */
function keyPair(): { publicKey: string; privatePem: string } {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519")
  return {
    publicKey: publicKey.export({ format: "der", type: "spki" }).toString("base64"),
    privatePem: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
  }
}

function signedBy(privatePem: string, version: string, file: string): string {
  const sha512 = createHash("sha512").update(readFileSync(file)).digest("base64")
  return sign(null, Buffer.from(`apiweave-update/1\n${version}\n${sha512}\n`), privatePem).toString("base64")
}

let dir: string
let installer: string
const key = keyPair()

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "apiweave-update-sig-"))
  installer = path.join(dir, "APIWeave-1.2.0-win-x64.exe")
  writeFileSync(installer, "pretend installer bytes")
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe("verifyUpdateFile", () => {
  it("accepts an installer signed by the embedded key", async () => {
    const signature = signedBy(key.privatePem, "1.2.0", installer)
    expect(await verifyUpdateFile(installer, "1.2.0", signature, key.publicKey)).toBeNull()
  })

  it("rejects an installer whose bytes changed after signing", async () => {
    const signature = signedBy(key.privatePem, "1.2.0", installer)
    writeFileSync(installer, "something else entirely")
    expect(await verifyUpdateFile(installer, "1.2.0", signature, key.publicKey)).toMatch(/signature check/)
  })

  it("rejects a signed installer relabelled as another version", async () => {
    // An old signed release dressed up as a newer one would be a downgrade.
    const signature = signedBy(key.privatePem, "1.1.0", installer)
    expect(await verifyUpdateFile(installer, "1.2.0", signature, key.publicKey)).toMatch(/signature check/)
  })

  it("rejects a signature from any other key", async () => {
    const signature = signedBy(keyPair().privatePem, "1.2.0", installer)
    expect(await verifyUpdateFile(installer, "1.2.0", signature, key.publicKey)).toMatch(/signature check/)
  })

  it("rejects an unsigned manifest", async () => {
    expect(await verifyUpdateFile(installer, "1.2.0", undefined, key.publicKey)).toMatch(/not signed/)
    expect(await verifyUpdateFile(installer, "1.2.0", "", key.publicKey)).toMatch(/not signed/)
  })

  it("rejects a garbage signature without throwing", async () => {
    expect(await verifyUpdateFile(installer, "1.2.0", "not base64 at all!", key.publicKey)).toMatch(/signature check/)
  })

  it("refuses every update while the build carries the placeholder key", async () => {
    const signature = signedBy(key.privatePem, "1.2.0", installer)
    expect(await verifyUpdateFile(installer, "1.2.0", signature, UPDATE_SIGNING_KEY_PLACEHOLDER)).toMatch(
      /no update signing key/,
    )
  })
})

describe("scripts/sign-update-manifest.mjs", () => {
  function run(args: string[], privatePem: string | undefined): { status: number | null; stderr: string } {
    const env = { ...process.env }
    delete env["UPDATE_SIGNING_PRIVATE_KEY"]
    if (privatePem !== undefined) env["UPDATE_SIGNING_PRIVATE_KEY"] = privatePem
    const result = spawnSync(process.execPath, [SIGN_SCRIPT, ...args], { env, encoding: "utf8" })
    return { status: result.status, stderr: result.stderr }
  }

  it("signs a manifest the app's verifier accepts", async () => {
    const manifest = path.join(dir, "latest.yml")
    writeFileSync(
      manifest,
      "version: 1.2.0\nfiles:\n  - url: APIWeave-1.2.0-win-x64.exe\n    sha512: x\npath: APIWeave-1.2.0-win-x64.exe\nsha512: x\n",
    )

    expect(run([manifest], key.privatePem).status).toBe(0)
    // A re-run (a retried release job) replaces the signature, never stacks one.
    expect(run([manifest], key.privatePem).status).toBe(0)

    const text = readFileSync(manifest, "utf8")
    const lines = text.split("\n").filter((line) => line.startsWith(`${UPDATE_SIGNATURE_FIELD}:`))
    expect(lines).toHaveLength(1)
    const signature = lines[0]?.slice(UPDATE_SIGNATURE_FIELD.length + 1).trim()
    expect(await verifyUpdateFile(installer, "1.2.0", signature, key.publicKey)).toBeNull()
  })

  it("fails loudly when the signing secret is missing", () => {
    const result = run([path.join(dir, "latest.yml")], undefined)
    expect(result.status).not.toBe(0)
    expect(result.stderr).toMatch(/UPDATE_SIGNING_PRIVATE_KEY is not set/)
  })

  it("refuses a secret that does not match the embedded public key", () => {
    // Whatever update_signing_key.ts holds (placeholder or real), a fresh
    // throwaway key is never it.
    const result = run(["--check"], keyPair().privatePem)
    expect(result.status).not.toBe(0)
    expect(result.stderr).toMatch(/does not match the public key/)
  })
})

describe("scripts/generate-update-signing-key.mjs", () => {
  // Run against a copy, so the real update_signing_key.ts is never touched.
  function sandbox(): string {
    const root = path.join(dir, "app")
    mkdirSync(path.join(root, "scripts"), { recursive: true })
    mkdirSync(path.join(root, "electron"), { recursive: true })
    copyFileSync(GENERATE_SCRIPT, path.join(root, "scripts/generate-update-signing-key.mjs"))
    copyFileSync(SIGN_SCRIPT, path.join(root, "scripts/sign-update-manifest.mjs"))
    writeFileSync(
      path.join(root, "electron/update_signing_key.ts"),
      `export const UPDATE_SIGNING_PUBLIC_KEY: string = "${UPDATE_SIGNING_KEY_PLACEHOLDER}"\n`,
    )
    return root
  }

  it("embeds a public key that the printed private key passes the release check against", () => {
    const root = sandbox()
    const privatePem = execFileSync(process.execPath, [path.join(root, "scripts/generate-update-signing-key.mjs")], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
    expect(privatePem).toMatch(/^-----BEGIN PRIVATE KEY-----/)
    expect(readFileSync(path.join(root, "electron/update_signing_key.ts"), "utf8")).not.toContain("PLACEHOLDER")

    const check = spawnSync(process.execPath, [path.join(root, "scripts/sign-update-manifest.mjs"), "--check"], {
      env: { ...process.env, UPDATE_SIGNING_PRIVATE_KEY: privatePem },
      encoding: "utf8",
    })
    expect(check.status).toBe(0)

    // A second run would strand every install built with the first key.
    const again = spawnSync(process.execPath, [path.join(root, "scripts/generate-update-signing-key.mjs")])
    expect(again.status).not.toBe(0)
  })
})
