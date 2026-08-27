import { describe, expect, it } from "vitest"
import { hydratePathFromLoginShell, mergePath, parseEnvPath } from "../login_path"

describe("mergePath", () => {
  it("prepends the shell's entries and drops duplicates", () => {
    expect(mergePath("/home/u/.local/bin:/usr/bin", "/usr/bin:/bin")).toBe("/home/u/.local/bin:/usr/bin:/bin")
  })

  it("keeps the inherited PATH when the shell reports nothing", () => {
    expect(mergePath("", "/usr/bin:/bin")).toBe("/usr/bin:/bin")
  })
})

describe("parseEnvPath", () => {
  /** An interactive rc file that prints a banner must not become the PATH. */
  it("ignores stdout noise before the marker", () => {
    const output = "welcome!\n__APIWEAVE_PATH__SHELL=/bin/zsh\nPATH=/a:/b\nHOME=/home/u\n"
    expect(parseEnvPath(output)).toBe("/a:/b")
  })

  it("returns undefined when the dump has no PATH", () => {
    expect(parseEnvPath("__APIWEAVE_PATH__HOME=/home/u\n")).toBeUndefined()
  })
})

describe("hydratePathFromLoginShell", () => {
  it("leaves env alone when the shell cannot be run", () => {
    const env = { PATH: "/usr/bin", SHELL: "/nonexistent/shell" }
    expect(hydratePathFromLoginShell(env)).toBeNull()
    expect(env.PATH).toBe("/usr/bin")
  })

  /** The reported bug: a GUI PATH missing the directory the CLI is installed in. */
  it.skipIf(process.platform === "win32")("recovers entries the GUI PATH never had", () => {
    const env = { PATH: "/usr/bin", SHELL: "/bin/sh" }
    const merged = hydratePathFromLoginShell(env)
    expect(merged).toContain("/usr/bin")
    expect(env.PATH).toBe(merged)
  })

  /** SHELL is unset for a macOS app launched from Finder — passwd still has it. */
  it.skipIf(process.platform === "win32")("falls back to the passwd login shell", () => {
    const env: NodeJS.ProcessEnv = { PATH: "/usr/bin" }
    expect(hydratePathFromLoginShell(env)).not.toBeNull()
  })
})
