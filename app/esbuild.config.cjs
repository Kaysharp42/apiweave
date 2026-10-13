const esbuild = require("esbuild")
const fs = require("node:fs")
const path = require("node:path")

// The migration runner reads *.sql from `__dirname/migrations` at runtime (see
// core/db/migrations.ts#defaultMigrationsPath). esbuild only bundles JS, so copy
// the SQL next to the bundled main.cjs - `__dirname` is dist/desktop there (and in
// the packaged app), and electron-builder's `files: dist/desktop/**` ships them.
function copyMigrations(outDir = "desktop") {
  const src = path.join(__dirname, "core", "db", "migrations")
  const dest = path.join(__dirname, "dist", outDir, "migrations")
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

const { dependencies } = require("./package.json")

const common = {
  bundle: true,
  tsconfig: "tsconfig.desktop.json",
  // `dependencies` is exactly what the desktop bundles leave as a plain
  // require: electron-builder copies those packages, and only those, into
  // app.asar. Everything else main, preload and the PTY host import is bundled
  // here, and the renderer is bundled by Vite, so their libraries belong in
  // devDependencies — listing one in `dependencies` ships it a second time.
  // Why each runtime dependency cannot be bundled:
  // - better-sqlite3, node-pty: native addons. node-pty also requires its
  //   binding through a computed string (`prebuilds/${platform}-${arch}/pty.node`)
  //   and on Windows resolves a worker script from `__dirname`, neither of which
  //   survives bundling (see build.asarUnpack in package.json).
  // - zod: v4 ships ESM-first with crypto/WASM deps that break under cjs bundling.
  // - libsodium-wrappers: prebuilt WASM.
  // - electron-updater: runs as the plain CommonJS package electron-builder
  //   expects, sharing the one hoisted builder-util-runtime that wrote
  //   latest.yml at build time.
  external: ["electron", ...Object.keys(dependencies)],
  format: "cjs",
  logLevel: "info",
  platform: "node",
  sourcemap: true,
  target: "node20",
}

// The headless runner (`apiweave run`, core/cli) runs under plain Node in CI,
// where there is no Electron: the plugin fails the build if anything on its
// import graph reaches for it. Built on its own with `--cli` so `npm run cli`
// does not rebuild the desktop bundles.
const noElectron = {
  name: "no-electron",
  setup(build) {
    build.onResolve({ filter: /^electron$/ }, (args) => ({
      errors: [{ text: `the CLI must not import electron (imported by ${args.importer})` }],
    }))
  },
}

const buildDesktop = () => Promise.all([
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
  // The script worker runs one user script on a worker thread, resolved by
  // core/runner/script_sandbox.ts from `__dirname` next to main.cjs, so a
  // script that spins until its deadline cannot stall main (see
  // build.asarUnpack in package.json: it is loaded from app.asar.unpacked).
  esbuild.build({
    ...common,
    entryPoints: ["core/runner/script_worker.ts"],
    outfile: "dist/desktop/script-worker.cjs",
  }),
]).then(() => copyMigrations()).then(copyIcon)

const cli = { ...common, external: Object.keys(dependencies), plugins: [noElectron], logLevel: "warning" }
const buildCli = () =>
  Promise.all([
    esbuild.build({
      ...cli,
      banner: { js: "#!/usr/bin/env node" },
      entryPoints: ["core/cli/bin.ts"],
      outfile: "dist/cli/apiweave.cjs",
    }),
    esbuild.build({ ...cli, entryPoints: ["core/runner/script_worker.ts"], outfile: "dist/cli/script-worker.cjs" }),
  ]).then(() => copyMigrations("cli"))

;(process.argv.includes("--cli") ? buildCli() : buildDesktop())
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
