import { useEffect, useState } from "react";
import { Minus, Square, Copy, X } from "lucide-react";

// Minimize / maximize / close for the frameless desktop window
// (frame:false in app/electron/main.cjs). Shared by the standalone TitleBar
// and by MainHeader, which absorbs the window chrome on routes that render it
// so the app shows one bar instead of two. Buttons drive the window over IPC
// (window.__APIWEAVE_DESKTOP__, exposed by the preload).
//
// Electron drag regions are CSS, not an attribute; WebkitAppRegion isn't in the
// standard CSSProperties type, so the casts are expected.
export const dragStyle = { WebkitAppRegion: "drag" } as React.CSSProperties;
export const noDragStyle = { WebkitAppRegion: "no-drag" } as React.CSSProperties;

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
      className={`inline-flex h-full w-11 items-center justify-center text-text-secondary transition-colors dark:text-text-secondary-dark ${
        danger
          ? "hover:bg-red-600 hover:text-white"
          : "hover:bg-surface-overlay hover:text-text-primary dark:hover:bg-surface-dark-overlay dark:hover:text-text-primary-dark"
      }`}
    >
      {children}
    </button>
  );
}

export function WindowControls() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const desktop = window.__APIWEAVE_DESKTOP__;
    if (!desktop?.onMaximizeChange) return;
    return desktop.onMaximizeChange(setMaximized);
  }, []);

  const desktop = window.__APIWEAVE_DESKTOP__;

  return (
    <div className="flex h-full items-stretch self-stretch" style={noDragStyle}>
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
  );
}
