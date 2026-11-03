// Build the standalone CLI package that CI installs, so a pipeline does not
// need a checkout of this repository or its build toolchain. The desktop app's
// package is private and pulls Electron; this package contains only the
// bundled CLI, its worker, the migrations and the two runtime dependencies the
// bundle actually requires.
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const appPackage = JSON.parse(fs.readFileSync(path.join(appDir, "package.json"), "utf8"))
const cliDir = path.join(appDir, "dist", "cli")
const packageDir = path.join(appDir, "dist", "cli-package")

const entry = path.join(cliDir, "apiweave.cjs")
if (!fs.existsSync(entry)) {
  console.error("dist/cli/apiweave.cjs is missing; run `npm run build:cli` first")
  process.exit(1)
}

fs.rmSync(packageDir, { recursive: true, force: true })
fs.mkdirSync(path.join(packageDir, "dist", "cli"), { recursive: true })
for (const file of ["apiweave.cjs", "script-worker.cjs"]) {
  fs.copyFileSync(path.join(cliDir, file), path.join(packageDir, "dist", "cli", file))
}
fs.cpSync(path.join(cliDir, "migrations"), path.join(packageDir, "dist", "cli", "migrations"), { recursive: true })
fs.copyFileSync(path.join(appDir, "..", "LICENSE"), path.join(packageDir, "LICENSE"))

const packageJson = {
  name: "@apiweave/cli",
  version: appPackage.version,
  description: "Headless APIWeave test runner for CI",
  license: "MIT",
  bin: { apiweave: "dist/cli/apiweave.cjs" },
  files: ["dist/cli", "README.md", "LICENSE"],
  engines: { node: ">=22.12.0" },
  dependencies: {
    "better-sqlite3": appPackage.dependencies["better-sqlite3"],
    zod: appPackage.dependencies["zod"],
  },
  repository: {
    type: "git",
    url: "git+https://github.com/Kaysharp42/apiweave.git",
    directory: "app",
  },
  homepage: "https://github.com/Kaysharp42/apiweave",
  bugs: { url: "https://github.com/Kaysharp42/apiweave/issues" },
}
fs.writeFileSync(path.join(packageDir, "package.json"), `${JSON.stringify(packageJson, null, 2)}\n`)
fs.writeFileSync(
  path.join(packageDir, "README.md"),
  `# @apiweave/cli

Headless \`apiweave run\` for CI: no Electron, no window and no APIWeave data
folder. It reads a workspace repository, a workflow export, an
\`.awecollection\` project or a Postman collection, and exits 0 when every run
passes, 1 when a test fails and 2 on a usage or configuration error.

\`\`\`bash
npm install -g ./apiweave-cli-${appPackage.version}.tgz
apiweave run ./tests --env Staging --reporter cli,junit
\`\`\`

See the [CI guide](https://github.com/Kaysharp42/apiweave/blob/main/docs/guides/ci.md).
`,
)

const npm = process.platform === "win32" ? "npm.cmd" : "npm"
const packed = execFileSync(npm, ["pack", "--pack-destination", path.join(appDir, "dist")], {
  cwd: packageDir,
  encoding: "utf8",
})
const tarball = packed.trim().split("\n").at(-1)
if (!tarball) throw new Error("npm pack did not report a tarball name")
console.log(path.join(appDir, "dist", tarball))
