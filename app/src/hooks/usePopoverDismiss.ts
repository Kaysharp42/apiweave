import { useEffect, useRef } from "react";
import type { UsePopoverDismissParams } from "../types/UsePopoverDismissParams";

/**
 * The keyboard and outside-press handling a popover inside a dialog needs. It
 * listens on the document in the capture phase, ahead of the dialog's own
 * handlers, and stops the keys it handles there.
 */
export function usePopoverDismiss(params: UsePopoverDismissParams): void {
  const latest = useRef(params);
  useEffect(() => {
    latest.current = params;
  });
  const { active } = params;

  useEffect(() => {
    if (!active) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!latest.current.onKeyDown(event)) return;
      event.preventDefault();
      event.stopPropagation();
    };
    const handlePointerDown = (event: MouseEvent) => {
      if (latest.current.rootRef.current?.contains(event.target as Node)) return;
      latest.current.onOutsidePress();
    };
    document.addEventListener("keydown", handleKeyDown, true);
    document.addEventListener("mousedown", handlePointerDown, true);
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      document.removeEventListener("mousedown", handlePointerDown, true);
    };
  }, [active]);
}
