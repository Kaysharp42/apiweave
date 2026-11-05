// node-pty 1.1.0 publishes its macOS `spawn-helper` prebuilds without the
// execute bit, so every PTY spawn on macOS fails with "posix_spawnp failed" —
// in dev and in the packaged app alike. Restore the bit after install;
// electron-builder copies the file mode into app.asar.unpacked.
import { chmodSync, existsSync, readdirSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const prebuildsDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "node_modules",
  "node-pty",
  "prebuilds",
)

if (process.platform !== "win32" && existsSync(prebuildsDir)) {
  for (const dir of readdirSync(prebuildsDir)) {
    const helper = path.join(prebuildsDir, dir, "spawn-helper")
    if (dir.startsWith("darwin-") && existsSync(helper)) chmodSync(helper, 0o755)
  }
}
