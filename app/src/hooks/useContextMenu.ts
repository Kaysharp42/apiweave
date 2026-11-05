import { useCallback, useState } from "react";
import type React from "react";
import type { ContextMenuController, ContextMenuOrigin } from "../types";

/**
 * Open/close state for one row's right-click menu.
 *
 * Lives per row rather than once per list so the coordinates and the row that
 * owns them can never disagree — the alternative (`{x, y, rowId}` in the list,
 * as `TabBar` does it) makes every row re-render on every right-click and needs
 * an id comparison in each one to decide whether the menu is theirs.
 */
export function useContextMenu(): ContextMenuController {
  const [origin, setOrigin] = useState<ContextMenuOrigin | null>(null);

  const openAt = useCallback(
    (anchor: React.MouseEvent | ContextMenuOrigin): void => {
      if ("preventDefault" in anchor) {
        // Suppress the OS menu, and keep the right-click off any parent row that
        // is also listening — a workflow nested under a project has two.
        anchor.preventDefault();
        anchor.stopPropagation();
        setOrigin({ x: anchor.clientX, y: anchor.clientY });
        return;
      }
      // A keyboard open (Shift+F10 / the ContextMenu key) has no pointer
      // position, so the caller passes the focused row's viewport rectangle.
      setOrigin(anchor);
    },
    [],
  );

  const close = useCallback((): void => setOrigin(null), []);

  return { origin, isOpen: origin !== null, openAt, close };
}
