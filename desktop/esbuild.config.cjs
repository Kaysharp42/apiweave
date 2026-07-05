const esbuild = require("esbuild")

const common = {
  bundle: true,
  external: ["better-sqlite3", "electron"],
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
    outfile: "dist/desktop/main.js",
  }),
  esbuild.build({
    ...common,
    entryPoints: ["electron/preload.ts"],
    outfile: "dist/desktop/preload.js",
  }),
]).catch((error) => {
  console.error(error)
  process.exit(1)
})
