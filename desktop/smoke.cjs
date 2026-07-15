// Render smoke test: launch the built Electron shell headless and assert the
// renderer actually loads the embedded SPA over app://. Catches a broken app://
// protocol handler, a broken preload, or a renderer that fails to mount before
// they ship. Run with `node smoke.cjs` (under Xvfb in CI).
//
// Requires the main process to be bundled first (`npm run build:electron`) and
// the frontend built (`../frontend/dist`) — both are the app's normal outputs.
const { spawn } = require("node:child_process")
const fs = require("node:fs")
const path = require("node:path")

// `require("electron")` from a plain Node process returns the path to the
// Electron binary (not the module) — that's what we spawn.
const electronBinary = require("electron")

const appDir = __dirname
const mainBundle = path.join(appDir, "dist", "desktop", "main.js")
if (!fs.existsSync(mainBundle)) {
  console.error(`[smoke] missing ${mainBundle} — run "npm run build:electron" first`)
  process.exit(1)
}

const TIMEOUT_MS = 30_000
// The main process logs this once loadURL("app://local/") resolves.
const OK = "[renderer] loaded app://local/"
// Any of these mean the shell came up broken.
const FAIL = ["did-fail-load", "render-process-gone", "[renderer] load failed"]

const child = spawn(electronBinary, [appDir, "--no-sandbox"], {
  cwd: appDir,
  env: { ...process.env, ELECTRON_ENABLE_LOGGING: "1" },
})

let settled = false
function finish(code, reason) {
  if (settled) return
  settled = true
  clearTimeout(timer)
  console.error(`[smoke] ${reason}`)
  try {
    child.kill("SIGKILL")
  } catch {
    // already gone
  }
  process.exit(code)
}

const timer = setTimeout(
  () => finish(1, `timed out after ${TIMEOUT_MS}ms without "${OK}"`),
  TIMEOUT_MS,
)

function scan(buf) {
  const text = buf.toString()
  process.stdout.write(text)
  if (text.includes(OK)) finish(0, "renderer loaded the SPA — OK")
  for (const marker of FAIL) {
    if (text.includes(marker)) finish(1, `renderer failure: ${marker}`)
  }
}

child.stdout.on("data", scan)
child.stderr.on("data", scan)
child.on("error", (err) => finish(1, `failed to launch Electron: ${err.message}`))
// The shell should stay up until we kill it — any exit before OK is a failure.
child.on("exit", (code) => finish(1, `Electron exited early (code ${code})`))
