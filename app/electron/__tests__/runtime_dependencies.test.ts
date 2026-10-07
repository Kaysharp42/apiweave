import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

// electron-builder copies every `dependencies` entry into app.asar, and
// esbuild.config.cjs leaves exactly those as plain requires. A package only the
// renderer (Vite) or the bundled main process uses must be a devDependency, or
// it ships a second time beside the bundle that already contains it — which is
// how the asar grew to 183 MB. `npm install <pkg>` saves to `dependencies` by
// default, so this is the check that catches it.
const appDir = path.resolve(__dirname, "..", "..")

function desktopSources(): string {
  return ["core", "electron", "shared"]
    .flatMap((dir) =>
      readdirSync(path.join(appDir, dir), { recursive: true, encoding: "utf8" })
        .filter((file) => /\.ts$/.test(file) && !/(__tests__|\.test\.ts$)/.test(file))
        .map((file) => readFileSync(path.join(appDir, dir, file), "utf8")),
    )
    .join("\n")
}

describe("runtime dependencies", () => {
  it("lists only packages the desktop process loads unbundled", () => {
    const pkg = JSON.parse(readFileSync(path.join(appDir, "package.json"), "utf8")) as {
      dependencies: Record<string, string>
    }
    const sources = desktopSources()
    const unused = Object.keys(pkg.dependencies).filter(
      (name) => !sources.includes(`from "${name}`) && !sources.includes(`require("${name}`),
    )
    expect(unused).toEqual([])
  })
})
