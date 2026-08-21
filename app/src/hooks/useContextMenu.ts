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

  const openAt = useCallback((event: React.MouseEvent): void => {
    // Suppress the OS menu, and keep the right-click off any parent row that is
    // also listening — a workflow nested under a project has two.
    event.preventDefault();
    event.stopPropagation();
    setOrigin({ x: event.clientX, y: event.clientY });
  }, []);

  const close = useCallback((): void => setOrigin(null), []);

  return { origin, openAt, close };
}
