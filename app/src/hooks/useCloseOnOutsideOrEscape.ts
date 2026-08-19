import { useEffect, useRef, type RefObject } from "react";

/**
 * Close a popover/dropdown on outside mousedown or Escape, while it is open.
 *
 * The shared listener pair behind every dropdown in the app: a click outside
 * the container closes it, Escape closes it. The reason is handed to `onClose`
 * because the two closures can differ — a keyboard user who opened a menu with
 * Enter expects Escape to return focus to the trigger, while an outside click
 * should only dismiss. `onClose` is read through a ref so the listeners are
 * attached once per open/close cycle rather than once per render — the callers
 * re-render for state that has nothing to do with the menu.
 */
export function useCloseOnOutsideOrEscape(
  open: boolean,
  onClose: (reason: "outside" | "escape") => void,
  containerRef: RefObject<HTMLElement | null>,
): void {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;

    const onDocClick = (event: MouseEvent): void => {
      if (!containerRef.current?.contains(event.target as Node)) {
        onCloseRef.current("outside");
      }
    };
    const onEscape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        onCloseRef.current("escape");
      }
    };

    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEscape);
    };
  }, [open, containerRef]);
}
