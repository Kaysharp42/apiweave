import { createContext } from "react";
import type { CanvasSurface } from "../types/CanvasSurface";

/**
 * How a page route tells the layout that it is sitting over the canvas.
 *
 * `MainLayout` keeps one canvas mounted for the whole session, so something has
 * to say when it is covered — a hidden canvas must not stay in the tab order,
 * be announced by a screen reader, or answer the global shortcuts.
 *
 * Reporting it from the surface is deliberate. `MainLayout` could test the path
 * instead, but that only works until someone adds a page route and forgets to
 * extend the test — the drift `isSettingsRoute` already warns about. Here the
 * component that covers the canvas *is* the component that reports it, so the
 * two cannot disagree.
 */
export const CanvasSurfaceContext = createContext<CanvasSurface>({
  setCovered: () => {},
});
