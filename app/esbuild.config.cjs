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

const common = {
  bundle: true,
  tsconfig: "tsconfig.desktop.json",
  // ponytail: zod v4 ships ESM-first + crypto/WASM deps that break under cjs
  // bundling — desktop already declares it as a runtime dep, so externalize.
  // libsodium-wrappers is prebuilt WASM; same story.
  external: ["better-sqlite3", "electron", "zod", "libsodium-wrappers"],
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
])
  .then(copyMigrations)
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
