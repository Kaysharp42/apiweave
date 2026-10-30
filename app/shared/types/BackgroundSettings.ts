/**
 * Whether APIWeave keeps running without its window — so the MCP bridge and
 * git sync stay reachable — and whether it starts with the user's session.
 */
export type BackgroundSettings = {
  /** Closing the window hides it to the tray instead of quitting. */
  readonly closeToTray: boolean
  /** Launched, hidden in the tray, when the user signs in. */
  readonly openAtLogin: boolean
}
