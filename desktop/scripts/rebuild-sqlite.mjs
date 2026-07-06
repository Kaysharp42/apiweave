// Rebuild better-sqlite3's native binary for a target runtime: `node` (vitest,
// system Node) or `electron` (the app). better-sqlite3 is a V8-ABI addon, so its
// single build/Release/better_sqlite3.node matches exactly one NODE_MODULE_VERSION
// — Node and Electron need different builds and can't share one file.
//
// electron-builder `install-app-deps` and `electron-rebuild -f` proved unreliable
// on Windows here (reported success but left the node-abi binary in place, via a
// stale .forge-meta marker). Driving prebuild-install directly with an explicit
// runtime+target fetches the correct prebuilt every time — no compiler needed.
//
// Usage: node scripts/rebuild-sqlite.mjs <node|electron>
import { execFileSync } from "node:child_process"
import { createRequire } from "node:module"
import fs from "node:fs"
import path from "node:path"

const require = createRequire(import.meta.url)
const target = process.argv[2] ?? "node"

const bsDir = path.dirname(require.resolve("better-sqlite3/package.json"))
// Run prebuild-install's JS entry via node — the .cmd/.ps1 bin shims can't be
// spawned directly by execFile on Windows, and the addon dir path has spaces.
const prebuildBin = require.resolve("prebuild-install/bin.js")

const args = ["--arch", process.arch]
if (target === "electron") {
  // prebuild-install maps the electron version → its NODE_MODULE_VERSION itself.
  const electronVersion = require("electron/package.json").version
  args.push("--runtime", "electron", "--target", electronVersion)
} else if (target !== "node") {
  throw new Error(`unknown target "${target}" — expected "node" or "electron"`)
}

console.log(`[rebuild-sqlite] better-sqlite3 for ${target} (${args.join(" ")})`)
// prebuild-install silently no-ops when a build already exists; remove it so the
// fetch always installs the binary for the requested runtime.
const binaryPath = path.join(bsDir, "build", "Release", "better_sqlite3.node")
fs.rmSync(path.join(bsDir, "build"), { recursive: true, force: true })
execFileSync(process.execPath, [prebuildBin, ...args], { cwd: bsDir, stdio: "inherit" })

// Verify the installed ABI. This script runs under Node, so a `node`-target build
// must dlopen here and an `electron`-target build must NOT (it needs Electron's
// NODE_MODULE_VERSION). A mismatch means prebuild-install served a poisoned cache
// entry (bytes for the wrong runtime under the right name) — fail loudly with the
// fix rather than let it crash later as an opaque "compiled against a different
// Node.js version" at app/test start.
const nodeLoadable = (() => {
  try {
    process.dlopen({ exports: {} }, binaryPath)
    return true
  } catch {
    return false
  }
})()
if (nodeLoadable !== (target === "node")) {
  throw new Error(
    `[rebuild-sqlite] installed binary is ${nodeLoadable ? "node" : "electron"} ABI but ${target} was requested — ` +
      `prebuild-install's cache is likely poisoned. Clear the "_prebuilds" folder under \`npm config get cache\` and re-run.`,
  )
}
console.log(`[rebuild-sqlite] verified ${target} ABI`)
