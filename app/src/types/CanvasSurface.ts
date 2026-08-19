/**
 * The value behind `CanvasSurfaceContext` — see that file for why a page route
 * reports this rather than the layout deriving it from the path.
 */
export interface CanvasSurface {
  /**
   * Called with `true` while a page route's surface covers the persistent
   * canvas, and with `false` when that surface goes away.
   */
  readonly setCovered: (covered: boolean) => void;
}
