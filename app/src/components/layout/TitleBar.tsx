import { isDesktopShell } from "../../utils/isDesktopShell";
import useWindowChromeStore from "../../stores/WindowChromeStore";
import { WindowControls, dragStyle } from "./WindowControls";

// Standalone window chrome for the desktop app. The native title bar is
// disabled (frame:false in app/electron/main.cjs) so this bar matches the app
// design on Windows and Linux. The bar is the drag handle via the Electron
// `-webkit-app-region` CSS.
//
// Routes that render MainHeader (the main app shell) fold the brand and the
// window buttons into that header instead and claim the chrome, so this bar
// steps aside rather than stacking a second, near-empty bar above it. Routes
// without a header — login, setup — still get this one.
export function TitleBar() {
  const headerOwnsChrome = useWindowChromeStore((s) => s.headerOwnsChrome);

  if (!isDesktopShell()) return null;
  if (headerOwnsChrome) return null;

  return (
    <div
      style={dragStyle}
      className="flex h-header flex-shrink-0 select-none items-center justify-between border-b border-border bg-surface-raised pl-4 dark:border-border-dark dark:bg-surface-dark-raised"
    >
      {/* Height and brand match MainHeader exactly, so the boot, setup and
          404 screens wear the same chrome as the app instead of a shorter,
          differently-styled bar. Those screens have no app controls to put
          between the two, which is the only difference. */}
      <div className="flex items-center gap-3 pointer-events-none">
        <img
          src="/apiweave.png"
          alt=""
          className="h-7 w-7 rounded object-cover"
        />
        <span className="font-sans text-lg font-extrabold tracking-tight text-text-primary dark:text-text-primary-dark">
          APIWeave
        </span>
      </div>

      <WindowControls />
    </div>
  );
}
