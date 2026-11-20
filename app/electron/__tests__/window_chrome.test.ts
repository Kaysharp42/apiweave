import { describe, expect, it } from "vitest"
import { isWindowChromeState, overlayColors } from "../window_chrome"

describe("overlayColors", () => {
  it("paints the controls in the title bar's colours when nothing dims the page", () => {
    expect(overlayColors({ dark: true, dimmed: false })).toEqual({
      color: "#18181b",
      symbolColor: "#fafafa",
    })
    expect(overlayColors({ dark: false, dimmed: false })).toEqual({
      color: "#fdfbf7",
      symbolColor: "#3a3026",
    })
  })

  // The controls are drawn above the page, where a dialog's backdrop cannot
  // reach: under a dialog they must take the colours the backdrop would give them.
  it("lays the dark backdrop (#09090b at 80%) over them under a dialog", () => {
    expect(overlayColors({ dark: true, dimmed: true })).toEqual({
      color: "#0c0c0e",
      symbolColor: "#39393b",
    })
  })

  it("lays the light backdrop (#3a3026 at 40%) over them under a dialog", () => {
    expect(overlayColors({ dark: false, dimmed: true })).toEqual({
      color: "#afaaa3",
      // The symbols are the backdrop's own colour, so the veil leaves them be.
      symbolColor: "#3a3026",
    })
  })
})

describe("isWindowChromeState", () => {
  it("accepts only the theme and the dimmed flag, both booleans", () => {
    expect(isWindowChromeState({ dark: true, dimmed: false })).toBe(true)
    expect(isWindowChromeState(true)).toBe(false)
    expect(isWindowChromeState(null)).toBe(false)
    expect(isWindowChromeState({ dark: true })).toBe(false)
    expect(isWindowChromeState({ dark: "yes", dimmed: false })).toBe(false)
  })
})
