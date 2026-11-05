import { isDesktopShell } from "../../utils/isDesktopShell";
import useWindowChromeStore from "../../stores/WindowChromeStore";
import { dragStyle, WINDOW_CONTROLS_INSET } from "../../utils/windowDragStyles";

// Standalone window chrome for the desktop app. The title bar is hidden
// (`titleBarStyle: "hidden"`/`"hiddenInset"` in electron/main.ts), so this bar
// provides the drag handle via Electron's `-webkit-app-region` CSS and the app's
// brand where the native bar would have been.
//
// Routes that render MainHeader (the main app shell) fold the brand into that
// header instead and claim the chrome, so this bar steps aside rather than
// stacking a second, near-empty bar above it. Routes without a header — the 404
// page, a failed workspace load — still get this one.
export function TitleBar() {
  const headerOwnsChrome = useWindowChromeStore((s) => s.headerOwnsChrome);

  if (!isDesktopShell()) return null;
  if (headerOwnsChrome) return null;

  return (
    <div
      // The native window controls sit over the top-right corner; reserve it so
      // the bar never grows content underneath them.
      style={{ ...dragStyle, paddingRight: WINDOW_CONTROLS_INSET }}
      className="aw-window-chrome flex h-header shrink-0 select-none items-center gap-3 border-b border-border bg-surface-raised pl-4 dark:border-border-dark dark:bg-surface-dark-raised"
    >
      {/* Height and brand match MainHeader exactly, so the error and
          404 screens wear the same chrome as the app instead of a shorter,
          differently-styled bar. Those screens have no app controls to put
          between the two, which is the only difference. */}
      <img
        src="/apiweave.png"
        alt=""
        className="h-7 w-7 rounded-sm object-cover pointer-events-none"
      />
      <span className="font-sans text-lg font-extrabold tracking-tight text-text-primary dark:text-text-primary-dark pointer-events-none">
        APIWeave
      </span>
    </div>
  );
}
