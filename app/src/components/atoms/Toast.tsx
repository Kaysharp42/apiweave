import { useContext, type CSSProperties } from "react";
import { Toaster } from "sonner";
import { AppContext } from "../../contexts/AppContext";
import type { AppContextType } from "../../types/AppContextType";
import { CanvasCornerGutter } from "../../constants/CanvasChrome";

/**
 * How far to keep the stack's toasts from the right edge.
 *
 * The canvas's bottom-right action stack is 36px wide and sits one
 * `CanvasCornerGutter` from the edge, so a toast at the same inset lands on top
 * of it. Moving the stack up instead would have to track the minimap and the
 * stack's own height; moving the toasts sideways is one number and holds for
 * every stack height.
 */
const ACTION_STACK_CLEARANCE = CanvasCornerGutter + 36 + 8;

export function Toast() {
  // Sonner's own `system` follows the OS, which is not necessarily the app's
  // theme: picking Light in APIWeave while the OS is dark used to give dark
  // toasts on a light page. The effective theme is the app's, not the OS's.
  const { darkMode } = useContext(AppContext) as AppContextType;

  return (
    <Toaster
      // Bottom-right, clear of the 32px status bar plus an 8px gap, and left of
      // the canvas action stack. The top edge is the frameless window's drag
      // region, where toasts used to sit and their close buttons were read as
      // window drags.
      position="bottom-right"
      offset={{ bottom: 40, right: ACTION_STACK_CLEARANCE }}
      closeButton
      expand
      theme={darkMode ? "dark" : "light"}
      // Sonner writes `--width: 356px` into its own inline style before
      // spreading this one, so overriding the variable here narrows every
      // toast. 300px keeps the stack clear of the canvas zoom controls at an
      // 800px-wide window without shortening the text enough to wrap.
      style={{ "--width": "300px" } as CSSProperties}
      toastOptions={{
        duration: 4000,
        className:
          "font-sans text-sm rounded-xs border border-border dark:border-border-dark bg-surface-raised dark:bg-surface-dark-raised text-text-primary dark:text-text-primary-dark shadow-popover",
        style: {
          fontFamily: "inherit",
        },
      }}
    />
  );
}
