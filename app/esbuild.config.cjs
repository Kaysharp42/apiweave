const esbuild = require("esbuild")
const fs = require("node:fs")
const path = require("node:path")

// The migration runner reads *.sql from `__dirname/migrations` at runtime (see
// core/db/migrations.ts#defaultMigrationsPath). esbuild only bundles JS, so copy
// the SQL next to the bundled main.cjs - `__dirname` is dist/desktop there (and in
// the packaged app), and electron-builder's `files: dist/desktop/**` ships them.
function copyMigrations() {
  const src = path.join(__dirname, "core", "db", "migrations")
  const dest = path.join(__dirname, "dist", "desktop", "migrations")
  // Windows file locking: try to remove, but if locked just overwrite contents
  if (fs.existsSync(dest)) {
    try {
      fs.rmSync(dest, { recursive: true, force: true })
    } catch {
      // Directory locked — overwrite files in place instead
      console.log("[copyMigrations] build dir locked, overwriting in place")
    }
  }
  fs.cpSync(src, dest, { recursive: true, force: true })
}

// BrowserWindow's `icon` option is read at runtime (see electron/main.ts) so the
// taskbar/dock icon is correct even in dev and on Linux, where the packaged
// executable's embedded icon resource doesn't cover it. Ship it next to
// main.cjs the same way migrations are shipped above.
function copyIcon() {
  const src = path.join(__dirname, "build", "icon.png")
  const dest = path.join(__dirname, "dist", "desktop", "icon.png")
  try {
    fs.copyFileSync(src, dest)
  } catch {
    // Windows file locking: dest may be held open by a running dev instance.
    console.log("[copyIcon] dest locked, skipping copy")
  }
}

const common = {
  bundle: true,
  tsconfig: "tsconfig.desktop.json",
  // ponytail: zod v4 ships ESM-first + crypto/WASM deps that break under cjs
  // bundling — desktop already declares it as a runtime dep, so externalize.
  // libsodium-wrappers is prebuilt WASM; same story.
  // electron-updater is externalized so it runs as the plain CommonJS package
  // electron-builder expects, sharing the one hoisted builder-util-runtime
  // that wrote latest.yml at build time. It does bundle cleanly today, but
  // that's the unsupported path and nothing would catch it silently drifting.
  // node-pty requires its native binding through a computed string
  // (`prebuilds/${platform}-${arch}/pty.node`), which esbuild cannot analyse,
  // and on Windows it resolves a worker script from `__dirname` — neither
  // survives bundling. It must stay a plain require against the unpacked
  // module directory (see build.asarUnpack in package.json).
  external: [
    "better-sqlite3",
    "electron",
    "electron-updater",
    "node-pty",
    "zod",
    "libsodium-wrappers",
  ],
  format: "cjs",
  logLevel: "info",
  platform: "node",
  sourcemap: true,
  target: "node20",
}

Promise.all([
  esbuild.build({
    ...common,
    entryPoints: ["electron/main.ts"],
    outfile: "dist/desktop/main.cjs",
  }),
  esbuild.build({
    ...common,
    entryPoints: ["electron/preload.ts"],
    outfile: "dist/desktop/preload.cjs",
  }),
  // The PTY host runs as an Electron utilityProcess, forked by
  // core/agents/agent_process_manager.ts from `__dirname` next to main.cjs. A
  // third entry point rather than a lazy import inside main: the whole point of
  // the utility process is that node-pty's native addon is loaded in a process
  // that can crash without taking main or a renderer with it.
  esbuild.build({
    ...common,
    entryPoints: ["electron/pty_host.ts"],
    outfile: "dist/desktop/pty-host.cjs",
  }),
])
  .then(copyMigrations)
  .then(copyIcon)
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
