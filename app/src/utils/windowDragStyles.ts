import type { CSSProperties } from "react";

// Electron drag regions are CSS, not an attribute; WebkitAppRegion isn't in the
// standard CSSProperties type, so the casts are expected. The whole window chrome
// is a drag handle, and every control inside it opts back out.
export const dragStyle = { WebkitAppRegion: "drag" } as CSSProperties;
export const noDragStyle = { WebkitAppRegion: "no-drag" } as CSSProperties;

/**
 * The width the native window controls cover at the top-right, plus an 8px
 * gutter, so the header can reserve it instead of letting its own actions slide
 * underneath. The fallbacks matter: outside the Window Controls Overlay (macOS,
 * the browser build) the `env()` variables are unset, and `titlebar-area-width`
 * then spans the viewport so only the gutter remains.
 */
export const WINDOW_CONTROLS_INSET =
  "calc(8px + 100vw - env(titlebar-area-x, 0px) - env(titlebar-area-width, 100vw))";
