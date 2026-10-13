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

// electron-builder's output layout: linux-unpacked/, win-unpacked/, mac/ or
// mac-arm64/ (APIWeave.app). The Linux executable is the package name.
function packagedBinary() {
  const dirs = existsSync(releaseDir) ? readdirSync(releaseDir) : []
  const candidates = {
    linux: dirs.filter((d) => d.startsWith("linux") && d.endsWith("unpacked")).map((d) => path.join(d, "apiweave")),
    win32: dirs.filter((d) => d.startsWith("win") && d.endsWith("unpacked")).map((d) => path.join(d, "APIWeave.exe")),
    darwin: dirs.filter((d) => d.startsWith("mac")).map((d) => path.join(d, "APIWeave.app", "Contents", "MacOS", "APIWeave")),
  }[process.platform] ?? []
  const found = candidates.map((c) => path.join(releaseDir, c)).find((c) => existsSync(c))
  if (!found) {
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
