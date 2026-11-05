// Launch the packaged app electron-builder left in release/ with --smoke-test
// (see electron/smoke_test.ts) in a throwaway profile, and exit with its code.
// Run after `electron-builder --dir` or any full build: both leave the unpacked
// app beside the installers. On Linux it needs a display — `xvfb-run` in CI.
import { spawn } from "node:child_process"
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const releaseDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "release")
const TIMEOUT_MS = 120_000

// electron-builder's output layout: the prefix and suffix of the directories
// it leaves behind for a platform, and the executable inside one.
const APP_LAYOUT = {
  linux: { prefix: "linux", suffix: "unpacked", executable: ["apiweave"] },
  win32: { prefix: "win", suffix: "unpacked", executable: ["APIWeave.exe"] },
  darwin: { prefix: "mac", suffix: "", executable: ["APIWeave.app", "Contents", "MacOS", "APIWeave"] },
}

function releaseEntries() {
  return existsSync(releaseDir) ? readdirSync(releaseDir) : []
}

// A combined macOS build leaves both mac/ and mac-arm64/ behind, so the one
// matching the runner's architecture comes before the other.
function appDirectories(dirs, layout) {
  const matches = dirs.filter((dir) => dir.startsWith(layout.prefix) && dir.endsWith(layout.suffix))
  if (process.platform !== "darwin") return matches
  const preferred = process.arch === "arm64" ? "mac-arm64" : "mac"
  return matches.filter((dir) => dir === preferred).concat(matches.filter((dir) => dir !== preferred))
}

function packagedBinary() {
  const layout = APP_LAYOUT[process.platform]
  const candidates = layout === undefined
    ? []
    : appDirectories(releaseEntries(), layout).map((dir) => path.join(releaseDir, dir, ...layout.executable))
  const found = candidates.find((candidate) => existsSync(candidate))
  if (found === undefined) {
    console.error(`[smoke] no packaged app for ${process.platform} in ${releaseDir} — run "npx electron-builder --dir" first`)
    process.exit(1)
  }
  return found
}

const binary = packagedBinary()
const userData = mkdtempSync(path.join(tmpdir(), "apiweave-smoke-"))
// The CI runners have no unprivileged user namespaces for Chromium's sandbox.
const args = ["--smoke-test", `--user-data-dir=${userData}`, ...(process.platform === "linux" ? ["--no-sandbox"] : [])]
console.log(`[smoke] ${binary} ${args.join(" ")}`)

const child = spawn(binary, args, { stdio: "inherit" })
const timer = setTimeout(() => {
  console.error(`[smoke] no exit after ${TIMEOUT_MS}ms`)
  child.kill("SIGKILL")
}, TIMEOUT_MS)

child.on("error", (error) => {
  console.error(`[smoke] failed to launch: ${error.message}`)
  process.exit(1)
})
child.on("exit", (code, signal) => {
  clearTimeout(timer)
  rmSync(userData, { recursive: true, force: true, maxRetries: 5 })
  console.log(`[smoke] exited with ${code ?? signal}`)
  process.exit(code === 0 ? 0 : 1)
})
