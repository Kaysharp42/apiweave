/**
 * What main needs to paint the parts of the window the page cannot: the
 * background behind it, and the native minimize/maximize/close controls drawn
 * over its top-right corner.
 */
export type WindowChromeState = {
  /** The theme the renderer resolved. */
  readonly dark: boolean
  /**
   * A dialog's backdrop is dimming the page. The native controls sit above
   * the page, out of the backdrop's reach, so main dims them to match.
   */
  readonly dimmed: boolean
}
