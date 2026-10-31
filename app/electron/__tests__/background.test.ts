import { describe, expect, it, vi } from "vitest"

vi.mock("electron", () => ({}))

const { autostartEntry } = await import("../background")

describe("autostartEntry", () => {
  it("launches the executable hidden, quoted so a path with spaces survives", () => {
    expect(autostartEntry("/home/me/Apps/APIWeave 1.0.AppImage")).toContain(
      'Exec="/home/me/Apps/APIWeave 1.0.AppImage" --hidden\n',
    )
  })

  it("escapes the characters the Desktop Entry spec reserves inside quotes", () => {
    expect(autostartEntry('/opt/a"b`c$d\\e')).toContain('Exec="/opt/a\\"b\\`c\\$d\\\\e" --hidden')
  })
})
