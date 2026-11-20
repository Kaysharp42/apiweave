import type { WindowChromeState } from "@shared/types/WindowChromeState"

/**
 * The window's own colours, mirrored from the renderer's surface tokens: the
 * page background (`--aw-surface`) and the header the native window controls
 * sit in (`--aw-surface-raised` / `--aw-text-primary`). Kept as literals because
 * main cannot read a CSS variable, and a mismatch is visible as a flash of the
 * wrong colour while the window paints.
 */
const WINDOW_COLORS = {
  dark: { background: "#09090b", titleBar: "#18181b", symbols: "#fafafa" },
  light: { background: "#fbf8f3", titleBar: "#fdfbf7", symbols: "#3a3026" },
} as const

/**
 * The renderer's dialog backdrop (the `Backdrop` atom): `bg-text-primary/40`
 * in light, `dark:bg-surface-dark/80` in dark. The native controls are drawn
 * above the page, so the backdrop cannot reach them; main lays the same veil
 * over their colours instead. Change both together.
 */
const BACKDROP = {
  dark: { color: "#09090b", opacity: 0.8 },
  light: { color: "#3a3026", opacity: 0.4 },
} as const

/** `h-header` in index.css — the native overlay is exactly as tall as the bar it covers. */
export const TITLE_BAR_HEIGHT = 48

export function windowColors(dark: boolean): (typeof WINDOW_COLORS)[keyof typeof WINDOW_COLORS] {
  return dark ? WINDOW_COLORS.dark : WINDOW_COLORS.light
}

/** `veil` at `opacity` composited over `base`: both `#rrggbb`. */
function underVeil(base: string, veil: string, opacity: number): string {
  const channel = (hex: string, at: number): number => Number.parseInt(hex.slice(at, at + 2), 16)
  return `#${[1, 3, 5]
    .map((at) => Math.round(channel(veil, at) * opacity + channel(base, at) * (1 - opacity)))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")}`
}

/** The native controls' colours: the title bar's, under the backdrop while a dialog is open. */
export function overlayColors({ dark, dimmed }: WindowChromeState): {
  color: string
  symbolColor: string
} {
  const colors = windowColors(dark)
  if (!dimmed) return { color: colors.titleBar, symbolColor: colors.symbols }
  const veil = dark ? BACKDROP.dark : BACKDROP.light
  return {
    color: underVeil(colors.titleBar, veil.color, veil.opacity),
    symbolColor: underVeil(colors.symbols, veil.color, veil.opacity),
  }
}

/** What `window:applyChrome` accepts from the renderer. */
export function isWindowChromeState(value: unknown): value is WindowChromeState {
  if (typeof value !== "object" || value === null) return false
  const { dark, dimmed } = value as Record<string, unknown>
  return typeof dark === "boolean" && typeof dimmed === "boolean"
}
