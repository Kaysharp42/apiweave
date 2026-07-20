import { useEffect, useState } from "react";
import { Minus, Square, Copy, X } from "lucide-react";
import { isDesktopShell } from "../../utils/isDesktopShell";

// Custom window chrome for the desktop app. The native title bar is disabled
// (frame:false in app/electron/main.cjs) so this bar matches the app design
// on Windows and Linux. The bar is the drag handle via the Electron
// `-webkit-app-region` CSS; the right buttons drive the window over IPC
// (window.__APIWEAVE_DESKTOP__, exposed by the preload).
//
// Electron drag regions are CSS, not an attribute; WebkitAppRegion isn't in the
// standard CSSProperties type, so the casts are expected.
const dragStyle = { WebkitAppRegion: "drag" } as React.CSSProperties;
const noDragStyle = { WebkitAppRegion: "no-drag" } as React.CSSProperties;

function ControlButton({
  label,
  onClick,
  danger = false,
  children,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      style={noDragStyle}
      className={`inline-flex h-8 w-11 items-center justify-center text-text-secondary transition-colors dark:text-text-secondary-dark ${
        danger
          ? "hover:bg-red-600 hover:text-white"
          : "hover:bg-surface-overlay hover:text-text-primary dark:hover:bg-surface-dark-overlay dark:hover:text-text-primary-dark"
      }`}
    >
      {children}
    </button>
  );
}

export function TitleBar() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const desktop = window.__APIWEAVE_DESKTOP__;
    if (!desktop?.onMaximizeChange) return;
    return desktop.onMaximizeChange(setMaximized);
  }, []);

  if (!isDesktopShell()) return null;

  const desktop = window.__APIWEAVE_DESKTOP__;

  return (
    <div
      style={dragStyle}
      className="flex h-8 flex-shrink-0 select-none items-center justify-between border-b border-border bg-surface-raised pl-3 dark:border-border-dark dark:bg-surface-dark-raised"
    >
      <div className="flex items-center gap-2 pointer-events-none">
        <img
          src="/apiweave.png"
          alt=""
          className="h-4 w-4 rounded object-cover"
        />
        <span className="text-xs font-semibold tracking-tight text-text-secondary dark:text-text-secondary-dark">
          APIWeave
        </span>
      </div>

      <div className="flex items-center" style={noDragStyle}>
        <ControlButton label="Minimize" onClick={() => desktop?.minimize()}>
          <Minus className="h-4 w-4" />
        </ControlButton>
        <ControlButton
          label={maximized ? "Restore" : "Maximize"}
          onClick={() => desktop?.toggleMaximize()}
        >
          {maximized ? (
            <Copy className="h-3.5 w-3.5" />
          ) : (
            <Square className="h-3.5 w-3.5" />
          )}
        </ControlButton>
        <ControlButton label="Close" danger onClick={() => desktop?.close()}>
          <X className="h-4 w-4" />
        </ControlButton>
      </div>
    </div>
  );
}
